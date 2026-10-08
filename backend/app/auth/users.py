from __future__ import annotations

import secrets
import time
from collections import defaultdict
from dataclasses import dataclass
from functools import lru_cache
from typing import Any

import bcrypt
import yaml
from fastapi import Request, status
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer

from ..config import Settings, get_settings
from ..errors import AppError
from ..fileutil import write_private_text

TRUSTED_PROXIES = {"127.0.0.1", "::1"}
MAX_PASSWORD_LENGTH = 72  # bcrypt ignores bytes beyond 72
USERNAME_PATTERN = r"^[A-Za-z0-9][A-Za-z0-9._@-]{0,63}$"


@dataclass
class UserRecord:
    username: str
    password_hash: str
    role: str
    session_version: int = 0
    must_change_password: bool = False


def _record_from_entry(user: dict[str, Any]) -> UserRecord:
    return UserRecord(
        username=user["username"],
        password_hash=user["password_hash"],
        role=user.get("role", "viewer"),
        session_version=int(user.get("session_version", 0)),
        must_change_password=bool(user.get("must_change_password", False)),
    )


class UserStore:
    def __init__(self, settings: Settings | None = None):
        self.settings = settings or get_settings()

    def load(self) -> dict[str, Any]:
        path = self.settings.users_yaml
        if not path.exists():
            raise FileNotFoundError(f"Users file not found: {path}")
        return yaml.safe_load(path.read_text(encoding="utf-8")) or {}

    def list_users(self) -> list[dict[str, str]]:
        data = self.load()
        return [
            {"username": u["username"], "role": u.get("role", "viewer")}
            for u in data.get("users", [])
        ]

    def get_user(self, username: str) -> UserRecord | None:
        data = self.load()
        for user in data.get("users", []):
            if user.get("username") == username:
                return _record_from_entry(user)
        return None

    def verify_password(self, username: str, password: str) -> UserRecord | None:
        user = self.get_user(username)
        # Always run bcrypt so response timing doesn't reveal whether the username exists.
        password_hash = user.password_hash if user else _dummy_hash()
        if bcrypt.checkpw(password.encode(), password_hash.encode()) and user:
            return user
        return None

    def _persist_users(self, data: dict[str, Any], users: list[dict[str, Any]]) -> None:
        if not any(u.get("role", "viewer") == "admin" for u in users):
            raise AppError("user.admin_required")
        data["users"] = users
        write_private_text(self.settings.users_yaml, yaml.safe_dump(data, sort_keys=False))

    def save_users(self, users: list[dict[str, str]], password_hashes: dict[str, str] | None = None) -> None:
        data = self.load()
        existing_by_name = {u.get("username"): u for u in data.get("users", [])}
        updated = []
        for user in users:
            username = user["username"]
            existing = existing_by_name.get(username)
            role = user.get("role", "viewer")
            entry: dict[str, Any] = {"username": username, "role": role}
            if password_hashes and username in password_hashes:
                entry["password_hash"] = password_hashes[username]
            elif existing:
                entry["password_hash"] = existing["password_hash"]
            else:
                raise AppError("user.missing_password", username=username)
            version = int(existing.get("session_version", 0)) if existing else 0
            if existing and (entry["password_hash"] != existing["password_hash"] or role != existing.get("role", "viewer")):
                version += 1
            entry["session_version"] = version
            if existing and existing.get("must_change_password"):
                entry["must_change_password"] = True
            updated.append(entry)
        self._persist_users(data, updated)

    def create_user(self, username: str, password: str, role: str, must_change_password: bool = False) -> None:
        username = username.strip()
        if not username:
            raise AppError("user.username_required")
        if not password:
            raise AppError("user.password_required")
        data = self.load()
        users = list(data.get("users") or [])
        if any(u.get("username") == username for u in users):
            raise AppError("user.exists", username=username)
        entry: dict[str, Any] = {
            "username": username,
            "role": role,
            "password_hash": hash_password(password),
            "session_version": 0,
        }
        if must_change_password:
            entry["must_change_password"] = True
        users.append(entry)
        self._persist_users(data, users)

    def update_user(self, username: str, role: str | None = None, password: str | None = None) -> None:
        data = self.load()
        users = list(data.get("users") or [])
        found = False
        for user in users:
            if user.get("username") != username:
                continue
            found = True
            changed = False
            if role is not None and role != user.get("role", "viewer"):
                user["role"] = role
                changed = True
            if password:
                user["password_hash"] = hash_password(password)
                changed = True
            if changed:
                user["session_version"] = int(user.get("session_version", 0)) + 1
            break
        if not found:
            raise AppError("user.not_found", status.HTTP_404_NOT_FOUND)
        self._persist_users(data, users)

    def change_own_password(self, username: str, current_password: str, new_password: str) -> UserRecord:
        if not self.verify_password(username, current_password):
            raise AppError("user.current_password_incorrect")
        if current_password == new_password:
            raise AppError("user.password_unchanged")
        data = self.load()
        users = list(data.get("users") or [])
        for user in users:
            if user.get("username") == username:
                user["password_hash"] = hash_password(new_password)
                user["session_version"] = int(user.get("session_version", 0)) + 1
                user.pop("must_change_password", None)
                self._persist_users(data, users)
                return _record_from_entry(user)
        raise AppError("user.not_found", status.HTTP_404_NOT_FOUND)

    def bump_session_version(self, username: str) -> None:
        """Invalidate every outstanding session for ``username``."""
        data = self.load()
        users = list(data.get("users") or [])
        for user in users:
            if user.get("username") == username:
                user["session_version"] = int(user.get("session_version", 0)) + 1
                self._persist_users(data, users)
                return

    def delete_user(self, username: str) -> None:
        data = self.load()
        users = list(data.get("users") or [])
        remaining = [u for u in users if u.get("username") != username]
        if len(remaining) == len(users):
            raise AppError("user.not_found", status.HTTP_404_NOT_FOUND)
        self._persist_users(data, remaining)


class LoginRateLimiter:
    def __init__(self, max_attempts: int = 5, window_seconds: int = 900, max_keys: int = 10_000):
        self.max_attempts = max_attempts
        self.window_seconds = window_seconds
        self.max_keys = max_keys
        self._attempts: dict[str, list[float]] = defaultdict(list)

    def _recent(self, key: str, now: float) -> list[float]:
        attempts = [t for t in self._attempts.get(key, []) if now - t < self.window_seconds]
        if attempts:
            self._attempts[key] = attempts
        else:
            self._attempts.pop(key, None)
        return attempts

    def check(self, key: str, max_attempts: int | None = None) -> None:
        limit = max_attempts or self.max_attempts
        if len(self._recent(key, time.time())) >= limit:
            raise AppError("auth.rate_limited", status.HTTP_429_TOO_MANY_REQUESTS)

    def record_failure(self, key: str) -> None:
        now = time.time()
        if len(self._attempts) >= self.max_keys:
            self._prune(now)
        self._attempts[key].append(now)

    def reset(self, key: str) -> None:
        self._attempts.pop(key, None)

    def _prune(self, now: float) -> None:
        for key in list(self._attempts):
            self._recent(key, now)
        # Still full of live entries: drop the oldest keys rather than grow without bound.
        overflow = len(self._attempts) - self.max_keys + 1
        if overflow > 0:
            oldest = sorted(self._attempts, key=lambda k: self._attempts[k][-1])[:overflow]
            for key in oldest:
                self._attempts.pop(key, None)


class SessionManager:
    def __init__(self, settings: Settings | None = None):
        self.settings = settings or get_settings()
        self._serializer: URLSafeTimedSerializer | None = None

    def _secret(self) -> str:
        path = self.settings.session_secret_file
        if not path.exists():
            write_private_text(path, secrets.token_hex(32))
        return path.read_text(encoding="utf-8").strip()

    @property
    def serializer(self) -> URLSafeTimedSerializer:
        if self._serializer is None:
            self._serializer = URLSafeTimedSerializer(self._secret(), salt="dui-session")
        return self._serializer

    def create_session_token(self, username: str, session_version: int) -> str:
        return self.serializer.dumps({"username": username, "ver": session_version})

    def load_session(self, token: str) -> dict[str, Any]:
        max_age = self.settings.session_ttl_hours * 3600
        try:
            return self.serializer.loads(token, max_age=max_age)
        except SignatureExpired as exc:
            raise AppError("auth.session_expired", status.HTTP_401_UNAUTHORIZED) from exc
        except BadSignature as exc:
            raise AppError("auth.invalid_session", status.HTTP_401_UNAUTHORIZED) from exc


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


@lru_cache
def _dummy_hash() -> str:
    return hash_password(secrets.token_hex(16))


def get_client_ip(request: Request) -> str:
    peer = request.client.host if request.client else "unknown"
    # Only nginx (on loopback) may vouch for the client address; X-Forwarded-For is client-controlled.
    if peer in TRUSTED_PROXIES:
        real_ip = request.headers.get("x-real-ip")
        if real_ip:
            return real_ip.strip()
    return peer
