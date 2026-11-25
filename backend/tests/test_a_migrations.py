"""Alembic baseline and the startup migration policy, on a scratch database."""
import logging

import pytest
from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.runtime.migration import MigrationContext
from sqlalchemy import text

from app.core import migrations
from app.core.config import settings
from app.core.database import Base


def test_fresh_database_is_migrated_then_skipped(scratch_db):
    url, engine = scratch_db
    assert migrations.current_revision(engine) is None
    assert migrations.run_migrations(engine, url) is True
    assert migrations.current_revision(engine) == "0001"
    assert migrations.run_migrations(engine, url) is False


def test_baseline_matches_the_models(scratch_db):
    url, engine = scratch_db
    migrations.run_migrations(engine, url)
    with engine.connect() as conn:
        diff = compare_metadata(MigrationContext.configure(conn), Base.metadata)
    assert diff == []


def test_downgrade_to_base_and_back(scratch_db):
    url, engine = scratch_db
    cfg = migrations.alembic_config(url)
    command.upgrade(cfg, "head")
    command.downgrade(cfg, "base")
    with engine.connect() as conn:
        tables = conn.execute(
            text("SELECT tablename FROM pg_tables WHERE schemaname = 'public'")
        ).scalars().all()
    assert set(tables) <= {"alembic_version"}
    command.upgrade(cfg, "head")
    assert migrations.current_revision(engine) == "0001"


def test_unknown_newer_revision_is_left_alone(scratch_db):
    url, engine = scratch_db
    migrations.run_migrations(engine, url)
    with engine.begin() as conn:
        conn.execute(text("UPDATE alembic_version SET version_num = '9999_future'"))
    assert migrations.run_migrations(engine, url) is False


def test_serverless_database_is_never_migrated_by_the_app(scratch_db, monkeypatch):
    url, engine = scratch_db
    monkeypatch.setattr(settings, "DSQL_ENDPOINT", "example.dsql.ca-central-1.on.aws")
    with pytest.raises(migrations.SchemaOutOfDateError):
        migrations.run_migrations(engine, url)
    assert migrations.current_revision(engine) is None


def test_loggers_stay_enabled_after_migrations(scratch_db):
    url, engine = scratch_db
    probe = logging.getLogger("folio.probe")
    migrations.run_migrations(engine, url)
    assert probe.disabled is False
