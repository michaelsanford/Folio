"""In-memory stand-in for the boto3 S3 client calls used by app.core.s3_sync.

Implements conditional PutObject semantics (IfMatch / IfNoneMatch="*") and
raises botocore ClientError with the same codes S3 returns, so tests exercise
the real error-classification paths.
"""
import hashlib
import io

from botocore.exceptions import ClientError


def client_error(code: str, status: int, operation: str) -> ClientError:
    return ClientError(
        {"Error": {"Code": code, "Message": code}, "ResponseMetadata": {"HTTPStatusCode": status}},
        operation,
    )


class FakeS3:
    def __init__(self):
        self.objects: dict[tuple[str, str], tuple[bytes, str]] = {}
        self.put_calls: list[dict] = []
        self.head_calls = 0
        self.get_calls = 0
        self.fail_get_with: Exception | None = None
        self.fail_head_with: Exception | None = None
        self.fail_put_with: Exception | None = None

    def seed(self, bucket: str, key: str, data: bytes) -> str:
        etag = f'"{hashlib.md5(data).hexdigest()}"'
        self.objects[(bucket, key)] = (data, etag)
        return etag

    def etag(self, bucket: str, key: str) -> str | None:
        entry = self.objects.get((bucket, key))
        return entry[1] if entry else None

    def head_object(self, Bucket, Key):
        self.head_calls += 1
        if self.fail_head_with:
            raise self.fail_head_with
        entry = self.objects.get((Bucket, Key))
        if entry is None:
            raise client_error("404", 404, "HeadObject")
        return {"ETag": entry[1], "ContentLength": len(entry[0])}

    def get_object(self, Bucket, Key):
        self.get_calls += 1
        if self.fail_get_with:
            raise self.fail_get_with
        entry = self.objects.get((Bucket, Key))
        if entry is None:
            raise client_error("NoSuchKey", 404, "GetObject")
        return {"Body": io.BytesIO(entry[0]), "ETag": entry[1]}

    def put_object(self, Bucket, Key, Body, **kwargs):
        data = Body.read() if hasattr(Body, "read") else Body
        self.put_calls.append({"Bucket": Bucket, "Key": Key, "size": len(data), **kwargs})
        if self.fail_put_with:
            raise self.fail_put_with
        current = self.objects.get((Bucket, Key))
        if "IfNoneMatch" in kwargs and current is not None:
            raise client_error("PreconditionFailed", 412, "PutObject")
        if "IfMatch" in kwargs and (current is None or current[1] != kwargs["IfMatch"]):
            raise client_error("PreconditionFailed", 412, "PutObject")
        etag = self.seed(Bucket, Key, data)
        return {"ETag": etag}
