from __future__ import annotations

from typing import Any

import yaml
from pydantic import BaseModel, Field, ValidationError

from ..config import Settings, get_settings
from ..errors import AppError, format_message
from ..fileutil import write_private_text
from .users import MAX_PASSWORD_LENGTH

# Admins choose the policy, but it can't go below this floor.
POLICY_MIN_LENGTH_FLOOR = 8


class PasswordPolicy(BaseModel):
    min_length: int = Field(default=8, ge=POLICY_MIN_LENGTH_FLOOR, le=MAX_PASSWORD_LENGTH)
    require_lowercase: bool = False
    require_uppercase: bool = False
    require_digit: bool = False
    require_symbol: bool = False
    disallow_username: bool = True

    def problem_codes(self, password: str, username: str | None = None) -> list[dict[str, Any]]:
        """Unmet rules as ``{"code", "params"}`` entries (see app/errors.py), empty when all are met."""
        found: list[dict[str, Any]] = []

        def add(code: str, **params: Any) -> None:
            found.append({"code": code, "params": params})

        if len(password) < self.min_length:
            add("password.min_length", min=self.min_length)
        if len(password.encode()) > MAX_PASSWORD_LENGTH:
            add("password.max_bytes", max=MAX_PASSWORD_LENGTH)
        if self.require_lowercase and not any(c.islower() for c in password):
            add("password.lowercase")
        if self.require_uppercase and not any(c.isupper() for c in password):
            add("password.uppercase")
        if self.require_digit and not any(c.isdigit() for c in password):
            add("password.digit")
        if self.require_symbol and all(c.isalnum() for c in password):
            add("password.symbol")
        if self.disallow_username and username and username.lower() in password.lower():
            add("password.no_username")
        return found

    def problems(self, password: str, username: str | None = None) -> list[str]:
        """Human-readable reasons ``password`` doesn't meet this policy (empty when it does)."""
        return [format_message(p["code"], p["params"]) for p in self.problem_codes(password, username)]

    def enforce(self, password: str, username: str | None = None) -> None:
        found = self.problem_codes(password, username)
        if found:
            english = ", ".join(format_message(p["code"], p["params"]) for p in found)
            raise AppError(
                "password.policy",
                detail=format_message("password.policy", {"problems": english}),
                problems=found,
            )


def load_policy(settings: Settings | None = None) -> PasswordPolicy:
    path = (settings or get_settings()).password_policy_yaml
    if not path.exists():
        return PasswordPolicy()
    try:
        return PasswordPolicy.model_validate(yaml.safe_load(path.read_text(encoding="utf-8")) or {})
    except (yaml.YAMLError, ValidationError):
        # A hand-edited, broken file must not weaken enforcement: fall back to the defaults.
        return PasswordPolicy()


def save_policy(policy: PasswordPolicy, settings: Settings | None = None) -> None:
    path = (settings or get_settings()).password_policy_yaml
    write_private_text(path, yaml.safe_dump(policy.model_dump(), sort_keys=False))
