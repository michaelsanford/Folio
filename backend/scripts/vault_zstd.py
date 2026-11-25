"""Compress or decompress a Folio export (zstd-compressed SQLite).

Exports (``python -m app.cli export``), teardown backups and closed-year
archives are SQLite files compressed with zstd. Use this to open one in a
SQLite tool, or to turn a plain ``.db`` (a vault file from a release that kept
the database in SQLite) into a file ``python -m app.cli import`` accepts.

    uv run python scripts/vault_zstd.py decompress folio-backup.db.zst folio-backup.db
    uv run python scripts/vault_zstd.py compress folio.db folio.db.zst
"""
import shutil
import sqlite3
import sys
from compression import zstd
from pathlib import Path

# Same settings as app.core.archive_store; standalone so it runs without the app's config.
ZSTD_LEVEL = 3
CHUNK = 1024 * 1024


def compress_file(src: Path, dst: Path) -> None:
    with src.open("rb") as fin, zstd.open(dst, "wb", level=ZSTD_LEVEL) as fout:
        shutil.copyfileobj(fin, fout, CHUNK)


def decompress_file(src: Path, dst: Path) -> None:
    with zstd.open(src, "rb") as fin, dst.open("wb") as fout:
        shutil.copyfileobj(fin, fout, CHUNK)


def _check_sqlite(path: Path) -> None:
    conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    try:
        result = conn.execute("PRAGMA quick_check").fetchone()[0]
    finally:
        conn.close()
    if result != "ok":
        raise SystemExit(f"{path} is not a healthy SQLite database: {result}")


def main(argv: list[str]) -> int:
    if len(argv) != 4 or argv[1] not in ("compress", "decompress"):
        print(__doc__, file=sys.stderr)
        return 2
    action, src, dst = argv[1], Path(argv[2]), Path(argv[3])
    if dst.exists():
        print(f"Refusing to overwrite {dst}", file=sys.stderr)
        return 1
    if action == "compress":
        _check_sqlite(src)
        compress_file(src, dst)
    else:
        decompress_file(src, dst)
        _check_sqlite(dst)
    print(f"{action}ed {src} -> {dst} ({dst.stat().st_size} bytes)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
