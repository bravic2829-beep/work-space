"""Password hashing. Uses argon2id through argon2-cffi, never a home-made scheme."""

import asyncio

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError

MIN_PASSWORD_LENGTH = 8

# Library defaults are argon2id with the parameters recommended in RFC 9106 (low-memory profile).
_hasher = PasswordHasher()


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password_hash: str, password: str) -> bool:
    """True only when the password matches. Any malformed hash counts as a mismatch."""
    try:
        return _hasher.verify(password_hash, password)
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False


def needs_rehash(password_hash: str) -> bool:
    """True when the hash was made with older, weaker parameters and should be upgraded."""
    return _hasher.check_needs_rehash(password_hash)


# Hashing is CPU heavy and blocks the event loop, so async code must call these wrappers.
async def hash_password_async(password: str) -> str:
    return await asyncio.to_thread(hash_password, password)


async def verify_password_async(password_hash: str, password: str) -> bool:
    return await asyncio.to_thread(verify_password, password_hash, password)
