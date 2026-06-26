"""
Authentication helpers — register, login, password reset.
Uses werkzeug's PBKDF2 hashing (already a Flask dependency, no extras needed).
"""
from __future__ import annotations

import secrets
import time

from werkzeug.security import check_password_hash, generate_password_hash

import db

RESET_TOKEN_TTL = 3600  # 1 hour


def hash_pw(password: str) -> str:
    return generate_password_hash(password)


def _check_pw(stored_hash: str, password: str) -> bool:
    return check_password_hash(stored_hash, password)


def register(email: str, name: str, password: str) -> tuple[int | None, str | None]:
    """Create a new account. Returns (user_id, None) on success, (None, error) on failure."""
    email = (email or "").strip().lower()
    if not email or "@" not in email:
        return None, "A valid email address is required."
    if len(password) < 8:
        return None, "Password must be at least 8 characters."
    if db.get_user_by_email(email):
        return None, "An account with that email already exists."
    user_id = db.upsert_user(email, (name or "").strip() or None)
    if not user_id:
        return None, "Could not create account — please try again."
    db.set_password(user_id, hash_pw(password))
    return user_id, None


def authenticate(email: str, password: str) -> int | None:
    """Returns user_id on success, None if credentials don't match."""
    email = (email or "").strip().lower()
    user = db.get_user_by_email(email)
    if not user or not user.get("password_hash"):
        return None
    if not _check_pw(user["password_hash"], password):
        return None
    return user["id"]


def create_reset_token(email: str) -> tuple[dict | None, str | None]:
    """Generate a password-reset token. Returns (user, token) or (None, None) if not found."""
    email = (email or "").strip().lower()
    user = db.get_user_by_email(email)
    if not user:
        return None, None
    token = secrets.token_urlsafe(32)
    db.set_reset_token(user["id"], token, int(time.time()) + RESET_TOKEN_TTL)
    return user, token


def redeem_reset_token(token: str, new_password: str) -> tuple[int | None, str | None]:
    """Validate token, set new password, clear token. Returns (user_id, None) or (None, error)."""
    if len(new_password) < 8:
        return None, "Password must be at least 8 characters."
    user = db.get_by_reset_token(token)
    if not user:
        return None, "This reset link is invalid or has expired."
    db.set_password(user["id"], hash_pw(new_password))
    db.clear_reset_token(user["id"])
    return user["id"], None
