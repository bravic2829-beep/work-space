from app.modules.auth.rate_limiter import LoginFailureLimiter


class FakeClock:
    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now


def make(max_failures: int = 3, lock_seconds: float = 60) -> tuple[LoginFailureLimiter, FakeClock]:
    clock = FakeClock()
    return LoginFailureLimiter(max_failures, lock_seconds, clock), clock


def test_not_locked_below_the_limit() -> None:
    limiter, _ = make()
    limiter.record_failure("E001")
    limiter.record_failure("E001")
    assert limiter.retry_after_seconds("E001") is None


def test_locked_at_the_limit_and_reports_the_wait() -> None:
    limiter, _ = make()
    for _ in range(3):
        limiter.record_failure("E001")
    assert limiter.retry_after_seconds("E001") == 61


def test_unlocks_after_the_lock_time() -> None:
    limiter, clock = make()
    for _ in range(3):
        limiter.record_failure("E001")
    clock.now += 61
    assert limiter.retry_after_seconds("E001") is None
    # A fresh start: the old failures no longer count.
    limiter.record_failure("E001")
    assert limiter.retry_after_seconds("E001") is None


def test_success_resets_the_counter() -> None:
    limiter, _ = make()
    limiter.record_failure("E001")
    limiter.record_failure("E001")
    limiter.reset("E001")
    limiter.record_failure("E001")
    limiter.record_failure("E001")
    assert limiter.retry_after_seconds("E001") is None


def test_keys_are_independent_and_case_insensitive() -> None:
    limiter, _ = make()
    for _ in range(3):
        limiter.record_failure("E001")
    assert limiter.retry_after_seconds("e001 ") is not None
    assert limiter.retry_after_seconds("E002") is None


def test_memory_stays_bounded() -> None:
    limiter, _ = make()
    for i in range(25_000):
        limiter.record_failure(f"code-{i}")
    assert len(limiter._entries) <= 10_000
