"""Compress or decompress a Folio vault file (zstd), for backups and restores.

The cloud vault is stored as ``database/folio.db.zst``: a SQLite file
compressed with zstd. Use this to open a downloaded copy locally, or to turn a
plain ``.db`` (a pre-migration or teardown backup) into an object you can
upload over the vault.

    uv run python scripts/vault_zstd.py decompress folio-restore.db.zst folio-restore.db
    uv run python scripts/vault_zstd.py compress folio.db.pre-migrate-0010.bak folio.db.zst
"""
import shutil
import sqlite3
import sys
from compression import zstd
from pathlib import Path

# Same settings as app.core.s3_sync; standalone so it runs without the app's config.
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
