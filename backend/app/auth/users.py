from __future__ import annotations

import secrets
import time
from collections import defaultdict
from dataclasses import dataclass
from typing import Any

import bcrypt
import yaml
from fastapi import HTTPException, Request, status
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer

from ..config import Settings, get_settings


@dataclass
class UserRecord:
    username: str
    password_hash: str
    role: str


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
                return UserRecord(
                    username=user["username"],
                    password_hash=user["password_hash"],
                    role=user.get("role", "viewer"),
                )
        return None

    def verify_password(self, username: str, password: str) -> UserRecord | None:
        user = self.get_user(username)
        if not user:
            return None
        if bcrypt.checkpw(password.encode(), user.password_hash.encode()):
            return user
        return None

    def _persist_users(self, data: dict[str, Any], users: list[dict[str, str]]) -> None:
        if not any(u.get("role", "viewer") == "admin" for u in users):
            raise HTTPException(status_code=400, detail="At least one admin user is required")
        data["users"] = users
        self.settings.users_yaml.write_text(yaml.safe_dump(data, sort_keys=False), encoding="utf-8")

    def save_users(self, users: list[dict[str, str]], password_hashes: dict[str, str] | None = None) -> None:
        data = self.load()
        existing_by_name = {u.get("username"): u for u in data.get("users", [])}
        updated = []
        for user in users:
            username = user["username"]
            existing = existing_by_name.get(username)
            entry = {"username": username, "role": user.get("role", "viewer")}
            if password_hashes and username in password_hashes:
                entry["password_hash"] = password_hashes[username]
            elif existing:
                entry["password_hash"] = existing["password_hash"]
            else:
                raise HTTPException(status_code=400, detail=f"Missing password for new user {username}")
            updated.append(entry)
        self._persist_users(data, updated)

    def create_user(self, username: str, password: str, role: str) -> None:
        username = username.strip()
        if not username:
            raise HTTPException(status_code=400, detail="Username is required")
        if not password:
            raise HTTPException(status_code=400, detail="Password is required")
        data = self.load()
        users = list(data.get("users") or [])
        if any(u.get("username") == username for u in users):
            raise HTTPException(status_code=400, detail=f"User {username} already exists")
        users.append(
            {
                "username": username,
                "role": role,
                "password_hash": hash_password(password),
            }
        )
        self._persist_users(data, users)

    def update_user(self, username: str, role: str | None = None, password: str | None = None) -> None:
        data = self.load()
        users = list(data.get("users") or [])
        found = False
        for user in users:
            if user.get("username") != username:
                continue
            found = True
            if role is not None:
                user["role"] = role
            if password:
                user["password_hash"] = hash_password(password)
            break
        if not found:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
        self._persist_users(data, users)

    def delete_user(self, username: str) -> None:
        data = self.load()
        users = list(data.get("users") or [])
        remaining = [u for u in users if u.get("username") != username]
        if len(remaining) == len(users):
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
        self._persist_users(data, remaining)


class LoginRateLimiter:
    def __init__(self, max_attempts: int = 5, window_seconds: int = 900):
        self.max_attempts = max_attempts
        self.window_seconds = window_seconds
        self._attempts: dict[str, list[float]] = defaultdict(list)

    def check(self, key: str) -> None:
        now = time.time()
        attempts = [t for t in self._attempts[key] if now - t < self.window_seconds]
        self._attempts[key] = attempts
        if len(attempts) >= self.max_attempts:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Too many login attempts. Try again later.",
            )

    def record_failure(self, key: str) -> None:
        self._attempts[key].append(time.time())

    def reset(self, key: str) -> None:
        self._attempts.pop(key, None)


class SessionManager:
    def __init__(self, settings: Settings | None = None):
        self.settings = settings or get_settings()
        self._serializer: URLSafeTimedSerializer | None = None

    def _secret(self) -> str:
        path = self.settings.session_secret_file
        if not path.exists():
            path.write_text(secrets.token_hex(32), encoding="utf-8")
        return path.read_text(encoding="utf-8").strip()

    @property
    def serializer(self) -> URLSafeTimedSerializer:
        if self._serializer is None:
            self._serializer = URLSafeTimedSerializer(self._secret(), salt="dui-session")
        return self._serializer

    def create_session_token(self, username: str, role: str) -> str:
        return self.serializer.dumps({"username": username, "role": role})

    def load_session(self, token: str) -> dict[str, str]:
        max_age = self.settings.session_ttl_hours * 3600
        try:
            return self.serializer.loads(token, max_age=max_age)
        except SignatureExpired as exc:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Session expired") from exc
        except BadSignature as exc:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid session") from exc


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def get_client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    if request.client:
        return request.client.host
    return "unknown"
