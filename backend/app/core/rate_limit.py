"""Minimal in-process rate limiting for authentication and MFA challenge endpoints.

Deliberately dependency-free. The window is per process: with several Lambda
containers (ReservedConcurrency 0 = unreserved) each holds its own counters, so
the effective ceiling is max_attempts x containers. That is accepted: CloudFront
in front and the account budget cap the exposure, and Cognito has its own
throttling and threat protection. Applies to /api/auth/login,
/api/auth/cognito/login and /api/auth/cognito/challenge.
"""
import threading
import time
from collections import deque

from app.core.config import settings

# Window and ceiling chosen to be invisible to a person who mistypes a password a
# few times, but to make brute force impractical.
DEFAULT_MAX_ATTEMPTS = 8
DEFAULT_WINDOW_SECONDS = 300

VIEWER_ADDRESS_HEADER = "CloudFront-Viewer-Address"


class SlidingWindowLimiter:
    def __init__(self, max_attempts: int = DEFAULT_MAX_ATTEMPTS, window_seconds: int = DEFAULT_WINDOW_SECONDS):
        self.max_attempts = max_attempts
        self.window_seconds = window_seconds
        self._hits: dict[str, deque[float]] = {}
        self._lock = threading.Lock()

    def _prune(self, key: str, now: float) -> deque[float] | None:
        """Drop expired hits; evict the key entirely once nothing is left."""
        hits = self._hits.get(key)
        if hits is None:
            return None
        cutoff = now - self.window_seconds
        while hits and hits[0] < cutoff:
            hits.popleft()
        if not hits:
            del self._hits[key]
            return None
        return hits

    def check(self, key: str) -> tuple[bool, int]:
        """Return (allowed, seconds_until_retry) without recording an attempt."""
        now = time.monotonic()
        with self._lock:
            hits = self._prune(key, now)
            if hits is not None and len(hits) >= self.max_attempts:
                return False, max(1, int(self.window_seconds - (now - hits[0])))
            return True, 0

    def record_failure(self, key: str) -> None:
        """Only failures count, so a legitimate user is never locked out by success."""
        now = time.monotonic()
        with self._lock:
            hits = self._prune(key, now)
            if hits is None:
                hits = self._hits[key] = deque()
            hits.append(now)

    def reset(self, key: str) -> None:
        with self._lock:
            self._hits.pop(key, None)

    def clear(self) -> None:
        with self._lock:
            self._hits.clear()

    def __len__(self) -> int:
        with self._lock:
            return len(self._hits)


login_limiter = SlidingWindowLimiter()


def client_key(request) -> str:
    """Identify the caller for rate limiting.

    Behind CloudFront (an origin secret is configured, so the global origin
    middleware guarantees the request came through the distribution) the viewer
    address is CloudFront-Viewer-Address, formatted "ip:port"; IPv6 addresses
    contain colons themselves, so only the last one separates the port.
    Otherwise the socket peer is used. X-Forwarded-For is never trusted: any
    caller can set it, which made the limiter trivially bypassable.
    """
    if settings.FOLIO_ORIGIN_VERIFY_SECRET:
        viewer = (request.headers.get(VIEWER_ADDRESS_HEADER) or "").strip()
        if viewer:
            host = viewer.rpartition(":")[0] if ":" in viewer else viewer
            host = host.strip("[]")
            if host:
                return host
    return request.client.host if request.client else "unknown"
