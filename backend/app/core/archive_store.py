"""Cold storage for closed-year archives.

On Lambda each archive is written once to ``archives/<year>/...`` in the
stack's bucket, in Glacier Instant Retrieval (rarely read, millisecond reads).
Docker and local installs keep them under ``DATA_DIR/archives`` instead (see
services/archive/yearly.py).
"""
import logging
import os
import shutil
import threading
from pathlib import Path

from compression import zstd

logger = logging.getLogger("folio.archives")

ZSTD_LEVEL = 3
CHUNK = 1024 * 1024
ARCHIVE_PREFIX = "archives/"
ARCHIVE_STORAGE_CLASS = "GLACIER_IR"

_client_lock = threading.Lock()
_clients: dict[str, object] = {}


def get_s3_client(region: str | None = None):
    """Return a cached boto3 S3 client (one per region, created thread-safely)."""
    region = region or os.getenv("AWS_REGION", os.getenv("AWS_DEFAULT_REGION", "ca-central-1"))
    client = _clients.get(region)
    if client is not None:
        return client
    with _client_lock:
        client = _clients.get(region)
        if client is None:
            import boto3

            client = boto3.client("s3", region_name=region)
            _clients[region] = client
        return client


def compress_file(src: Path, dst: Path) -> None:
    """zstd-compress ``src`` into ``dst`` (streamed, constant memory)."""
    with src.open("rb") as fin, zstd.open(dst, "wb", level=ZSTD_LEVEL) as fout:
        shutil.copyfileobj(fin, fout, CHUNK)


def decompress_file(src: Path, dst: Path) -> None:
    with zstd.open(src, "rb") as fin, dst.open("wb") as fout:
        shutil.copyfileobj(fin, fout, CHUNK)


def upload_archive(file_path: Path, key: str, bucket_name: str, region: str = "ca-central-1") -> None:
    """Store a closed-year archive in cold storage. Raises on failure."""
    if not bucket_name:
        raise RuntimeError("No bucket for the archive")
    client = get_s3_client(region)
    with Path(file_path).open("rb") as body:
        client.put_object(
            Bucket=bucket_name,
            Key=key,
            Body=body,
            ContentType="application/zstd",
            StorageClass=ARCHIVE_STORAGE_CLASS,
        )
    logger.info(f"Stored archive s3://{bucket_name}/{key}")


def download_archive(key: str, bucket_name: str, region: str = "ca-central-1") -> bytes:
    """The stored bytes of an archive (still compressed)."""
    if not bucket_name:
        raise RuntimeError("No bucket for the archive")
    body = get_s3_client(region).get_object(Bucket=bucket_name, Key=key)["Body"]
    return body.read() if hasattr(body, "read") else body
