import time
from collections.abc import Callable
from dataclasses import dataclass

_MAX_TRACKED_KEYS = 10_000


@dataclass
class _Entry:
    failures: int
    locked_until: float  # 0 while not locked


class LoginFailureLimiter:
    """Locks one key (an employee code) for a short time after too many failed logins.

    It lives in the memory of the single backend instance and resets when it restarts. That is
    enough for the MVP (see docs/context.md); a shared store is needed only with several
    instances. The key is the submitted employee code, whether or not it exists, so the
    behavior does not reveal which codes are real. The client IP is not used because behind
    the Next.js proxy every request would share one address.
    """

    def __init__(
        self,
        max_failures: int,
        lock_seconds: float,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._max_failures = max_failures
        self._lock_seconds = lock_seconds
        self._clock = clock
        self._entries: dict[str, _Entry] = {}

    @staticmethod
    def _normalize(key: str) -> str:
        return key.strip().casefold()

    def retry_after_seconds(self, key: str) -> int | None:
        """Seconds to wait when the key is locked, otherwise None."""
        entry = self._entries.get(self._normalize(key))
        if entry is None or entry.locked_until <= 0:
            return None
        remaining = entry.locked_until - self._clock()
        if remaining <= 0:
            del self._entries[self._normalize(key)]
            return None
        return int(remaining) + 1

    def record_failure(self, key: str) -> None:
        normalized = self._normalize(key)
        if len(self._entries) >= _MAX_TRACKED_KEYS:
            self._prune()
        entry = self._entries.setdefault(normalized, _Entry(failures=0, locked_until=0))
        entry.failures += 1
        if entry.failures >= self._max_failures:
            entry.locked_until = self._clock() + self._lock_seconds

    def reset(self, key: str) -> None:
        self._entries.pop(self._normalize(key), None)

    def _prune(self) -> None:
        now = self._clock()
        expired = [k for k, e in self._entries.items() if 0 < e.locked_until <= now]
        for key in expired:
            del self._entries[key]
        if len(self._entries) >= _MAX_TRACKED_KEYS:
            # Still full: drop the oldest half so memory cannot grow without bound.
            for key in list(self._entries)[: _MAX_TRACKED_KEYS // 2]:
                del self._entries[key]
