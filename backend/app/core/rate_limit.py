"""Minimal in-process rate limiting for the login endpoint.

Deliberately not a distributed limiter: Folio runs as a single instance (the SAM
template pins reserved concurrency to 1), so a per-process sliding window is
sufficient and adds no dependency. It bounds an online guessing attack against a
single master passphrase, which previously had no limit at all.
"""
import threading
import time
from collections import defaultdict, deque

# Window and ceiling chosen to be invisible to a person who mistypes a password a
# few times, but to make brute force impractical.
DEFAULT_MAX_ATTEMPTS = 8
DEFAULT_WINDOW_SECONDS = 300


class SlidingWindowLimiter:
    def __init__(self, max_attempts: int = DEFAULT_MAX_ATTEMPTS, window_seconds: int = DEFAULT_WINDOW_SECONDS):
        self.max_attempts = max_attempts
        self.window_seconds = window_seconds
        self._hits: dict[str, deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()

    def _prune(self, key: str, now: float) -> deque[float]:
        hits = self._hits[key]
        cutoff = now - self.window_seconds
        while hits and hits[0] < cutoff:
            hits.popleft()
        return hits

    def check(self, key: str) -> tuple[bool, int]:
        """Return (allowed, seconds_until_retry) without recording an attempt."""
        now = time.monotonic()
        with self._lock:
            hits = self._prune(key, now)
            if len(hits) >= self.max_attempts:
                return False, max(1, int(self.window_seconds - (now - hits[0])))
            return True, 0

    def record_failure(self, key: str) -> None:
        """Only failures count, so a legitimate user is never locked out by success."""
        now = time.monotonic()
        with self._lock:
            self._prune(key, now)
            self._hits[key].append(now)

    def reset(self, key: str) -> None:
        with self._lock:
            self._hits.pop(key, None)

    def clear(self) -> None:
        with self._lock:
            self._hits.clear()


login_limiter = SlidingWindowLimiter()


def client_key(request) -> str:
    """Identify the caller, preferring the edge-forwarded address when present."""
    forwarded = request.headers.get("X-Forwarded-For", "")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"
