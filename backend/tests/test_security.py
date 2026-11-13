from app.core.security import (
    hash_password,
    hash_password_async,
    needs_rehash,
    verify_password,
    verify_password_async,
)


def test_hash_is_argon2id_and_never_contains_the_password() -> None:
    hashed = hash_password("correct horse battery")
    assert hashed.startswith("$argon2id$")
    assert "correct horse battery" not in hashed


def test_same_password_gives_different_hashes() -> None:
    # A random salt per hash: identical passwords must not be recognizable in the database.
    assert hash_password("same password") != hash_password("same password")


def test_verify_accepts_the_right_password_only() -> None:
    hashed = hash_password("right-password")
    assert verify_password(hashed, "right-password") is True
    assert verify_password(hashed, "wrong-password") is False
    assert verify_password(hashed, "") is False


def test_verify_treats_a_malformed_hash_as_a_mismatch() -> None:
    assert verify_password("not-a-hash", "anything") is False
    assert verify_password("", "anything") is False


def test_fresh_hash_does_not_need_rehash() -> None:
    assert needs_rehash(hash_password("pw-12345678")) is False


async def test_async_wrappers_match_the_sync_functions() -> None:
    hashed = await hash_password_async("async-password")
    assert await verify_password_async(hashed, "async-password") is True
    assert await verify_password_async(hashed, "other") is False
