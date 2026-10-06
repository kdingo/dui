from __future__ import annotations

import yaml
from fastapi import HTTPException, status
from pydantic import BaseModel, Field, ValidationError

from ..config import Settings, get_settings
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

    def problems(self, password: str, username: str | None = None) -> list[str]:
        """Human-readable reasons ``password`` doesn't meet this policy (empty when it does)."""
        found = []
        if len(password) < self.min_length:
            found.append(f"at least {self.min_length} characters")
        if len(password.encode()) > MAX_PASSWORD_LENGTH:
            found.append(f"at most {MAX_PASSWORD_LENGTH} bytes")
        if self.require_lowercase and not any(c.islower() for c in password):
            found.append("a lowercase letter")
        if self.require_uppercase and not any(c.isupper() for c in password):
            found.append("an uppercase letter")
        if self.require_digit and not any(c.isdigit() for c in password):
            found.append("a digit")
        if self.require_symbol and all(c.isalnum() for c in password):
            found.append("a symbol")
        if self.disallow_username and username and username.lower() in password.lower():
            found.append("no username in it")
        return found

    def enforce(self, password: str, username: str | None = None) -> None:
        found = self.problems(password, username)
        if found:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Password does not meet the policy: needs " + ", ".join(found),
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
