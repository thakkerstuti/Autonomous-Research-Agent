"""Argon2id password hashing (argon2-cffi, RFC 9106 recommended parameters)."""
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError

_hasher = PasswordHasher()

# Verifying against this when the account does not exist (or has no password)
# keeps response time the same, so timing does not reveal registered emails.
_DUMMY_HASH = _hasher.hash("cognexa-timing-equaliser")

MIN_LENGTH = 10
MAX_LENGTH = 128


def password_problem(password: str) -> str | None:
    if len(password) < MIN_LENGTH:
        return f"Use at least {MIN_LENGTH} characters."
    if len(password) > MAX_LENGTH:
        return f"Use at most {MAX_LENGTH} characters."
    if not password.strip():
        return "The password can't be only spaces."
    return None


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password: str, stored_hash: str | None) -> bool:
    try:
        return _hasher.verify(stored_hash or _DUMMY_HASH, password) and stored_hash is not None
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False


def needs_rehash(stored_hash: str) -> bool:
    try:
        return _hasher.check_needs_rehash(stored_hash)
    except InvalidHashError:
        return False
