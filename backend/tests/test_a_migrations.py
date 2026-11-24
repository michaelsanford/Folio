"""Startup migrations: skip at head, back up before upgrading, keep logging alive."""
import logging
import sqlite3
from unittest.mock import patch

import pytest
from alembic import command
from alembic.script import ScriptDirectory

from app.core import migrations
from app.core.config import settings
from app.core.logging import _FolioHandler, configure_logging


@pytest.fixture
def temp_db(tmp_path, monkeypatch):
    db_path = tmp_path / "folio.db"
    monkeypatch.setattr(settings, "SQLITE_DB_PATH", db_path)
    monkeypatch.setattr(settings, "S3_BUCKET_NAME", "")
    return db_path


def _revisions():
    script = ScriptDirectory.from_config(migrations._alembic_config())
    head = script.get_current_head()
    previous = script.get_revision(head).down_revision
    return head, previous


def test_fresh_database_is_migrated_then_skipped(temp_db):
    head, _ = _revisions()
    assert migrations.run_migrations() is True
    assert migrations.current_revision(temp_db) == head
    assert not list(temp_db.parent.glob("*.bak")), "nothing to back up on an empty database"

    with patch("app.core.migrations.command.upgrade") as upgrade:
        assert migrations.run_migrations() is False
    upgrade.assert_not_called()


def test_upgrade_from_an_older_revision_takes_a_backup_first(temp_db, monkeypatch):
    head, previous = _revisions()
    command.upgrade(migrations._alembic_config(), previous)
    assert migrations.current_revision(temp_db) == previous

    # The pre-migration copy goes to S3 only on Lambda.
    monkeypatch.setenv("AWS_LAMBDA_FUNCTION_NAME", "folio")
    monkeypatch.setattr(settings, "S3_BUCKET_NAME", "vault-bucket")
    with patch("app.core.s3_sync.upload_backup", return_value=True) as upload:
        assert migrations.run_migrations() is True

    backups = list(temp_db.parent.glob(f"folio.db.pre-migrate-{previous}-*.bak"))
    assert len(backups) == 1
    conn = sqlite3.connect(str(backups[0]))
    try:
        assert conn.execute("SELECT version_num FROM alembic_version").fetchone()[0] == previous
    finally:
        conn.close()
    assert migrations.current_revision(temp_db) == head

    upload.assert_called_once()
    key = upload.call_args.args[1]
    assert key.startswith(f"backups/pre-migrate-{previous}-") and key.endswith(".db")


def test_backup_is_never_uploaded_outside_lambda(temp_db, monkeypatch):
    """Docker / local is development only: a bucket set there is ignored."""
    _, previous = _revisions()
    command.upgrade(migrations._alembic_config(), previous)

    monkeypatch.delenv("AWS_LAMBDA_FUNCTION_NAME", raising=False)
    monkeypatch.setattr(settings, "S3_BUCKET_NAME", "vault-bucket")
    with (
        patch("boto3.client", side_effect=AssertionError("no AWS client outside Lambda")) as make_client,
        patch("app.core.s3_sync.get_s3_client", side_effect=AssertionError("no S3 outside Lambda")) as get_client,
    ):
        assert migrations.run_migrations() is True
    make_client.assert_not_called()
    get_client.assert_not_called()
    assert len(list(temp_db.parent.glob(f"folio.db.pre-migrate-{previous}-*.bak"))) == 1


def test_only_the_newest_local_backups_are_kept(temp_db):
    conn = sqlite3.connect(str(temp_db))
    conn.execute("CREATE TABLE t (x INT)")
    conn.commit()
    conn.close()
    for _ in range(5):
        migrations.backup_database(temp_db, "rev")
    assert len(list(temp_db.parent.glob("folio.db.pre-migrate-*.bak"))) == migrations.LOCAL_BACKUPS_TO_KEEP


def test_unknown_newer_revision_is_left_alone(temp_db):
    conn = sqlite3.connect(str(temp_db))
    conn.execute("CREATE TABLE alembic_version (version_num VARCHAR(32) NOT NULL)")
    conn.execute("INSERT INTO alembic_version VALUES ('from_the_future')")
    conn.commit()
    conn.close()
    with patch("app.core.migrations.command.upgrade") as upgrade:
        assert migrations.run_migrations() is False
    upgrade.assert_not_called()


def test_loggers_stay_enabled_after_migrations(temp_db):
    configure_logging()
    sync_logger = logging.getLogger("folio.s3_sync")
    migrations.run_migrations()
    assert sync_logger.disabled is False
    assert logging.getLogger("folio.migrations").disabled is False
    assert any(isinstance(h, _FolioHandler) for h in logging.getLogger().handlers), (
        "env.py must not replace the application's JSON handler"
    )


def test_full_startup_migrates_seeds_and_restarts_cheaply(tmp_path):
    """Real lifespan in a subprocess (the engine binds SQLITE_DB_PATH at import)."""
    import json as _json
    import os
    import subprocess
    import sys
    from pathlib import Path

    script = """
import json, logging
from unittest.mock import patch
from fastapi.testclient import TestClient
from app.main import app
from app.core import migrations
with patch.object(migrations.command, "upgrade", wraps=migrations.command.upgrade) as up:
    with TestClient(app) as c:
        status = c.get("/api/health").status_code
from app.core.database import SessionLocal
from app.models.category import Category
from app.models.rule import CategorizationRule
db = SessionLocal()
print(json.dumps({"status": status, "upgrades": up.call_count,
                  "categories": db.query(Category).count(),
                  "rules": db.query(CategorizationRule).count(),
                  "sync_logger_disabled": logging.getLogger("folio.s3_sync").disabled}))
"""
    env = {**os.environ, "SQLITE_DB_PATH": str(tmp_path / "folio.db"), "FOLIO_SKIP_STARTUP_TASKS": "0"}
    for key in ("S3_BUCKET_NAME", "AWS_LAMBDA_FUNCTION_NAME", "FOLIO_ENV"):
        env.pop(key, None)
    backend = Path(__file__).resolve().parent.parent

    results = []
    for _ in range(2):
        out = subprocess.run([sys.executable, "-c", script], cwd=backend, env=env,
                             capture_output=True, text=True, timeout=180)
        assert out.returncode == 0, out.stderr[-2000:]
        results.append(_json.loads(out.stdout.strip().splitlines()[-1]))

    first, second = results
    assert first["status"] == 200 and second["status"] == 200
    assert first["upgrades"] == 1
    assert second["upgrades"] == 0, "a database already at head must not invoke Alembic"
    assert first["categories"] > 0 and first["rules"] > 0
    assert second["categories"] == first["categories"] and second["rules"] == first["rules"]
    assert first["sync_logger_disabled"] is False


def _write_revision(directory, revision: str, down_revision: str, body: str) -> None:
    (directory / f"{revision}_fake.py").write_text(
        f'''"""Fake revision for the atomicity test."""
import sqlalchemy as sa
from alembic import op

revision = "{revision}"
down_revision = "{down_revision}"
branch_labels = None
depends_on = None


def upgrade() -> None:
{body}


def downgrade() -> None:
    pass
''',
        encoding="utf-8",
    )


def test_a_failed_upgrade_rolls_back_every_revision_in_the_run(temp_db, tmp_path):
    """The real env.py runs the whole upgrade as one transaction.

    Two fake revisions on top of the real head: the first creates a table and
    succeeds, the second creates a table and then fails. Neither table may
    survive, and alembic_version must still name the real head.
    """
    import os

    head, _ = _revisions()
    cfg = migrations._alembic_config()
    command.upgrade(cfg, "head")
    assert migrations.current_revision(temp_db) == head

    extra = tmp_path / "extra_versions"
    extra.mkdir()
    _write_revision(
        extra, "zz_fake_ok", head,
        '    op.create_table("atomicity_ok", sa.Column("id", sa.Integer, primary_key=True))',
    )
    _write_revision(
        extra, "zz_fake_boom", "zz_fake_ok",
        '    op.create_table("atomicity_partial", sa.Column("id", sa.Integer, primary_key=True))\n'
        '    raise RuntimeError("migration failed halfway")',
    )
    real_versions = migrations.ALEMBIC_INI.parent / "migrations" / "versions"
    # The real script directory (and so the real env.py), plus the fake revisions.
    cfg.set_main_option("version_locations", os.pathsep.join([str(real_versions), str(extra)]))
    assert ScriptDirectory.from_config(cfg).get_current_head() == "zz_fake_boom"

    with pytest.raises(RuntimeError, match="migration failed halfway"):
        command.upgrade(cfg, "head")

    assert migrations.current_revision(temp_db) == head
    conn = sqlite3.connect(str(temp_db))
    try:
        tables = {row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    finally:
        conn.close()
    assert "atomicity_ok" not in tables
    assert "atomicity_partial" not in tables
    assert "accounts" in tables, "the schema from earlier revisions is untouched"
