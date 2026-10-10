"""User administration from inside the container.

    python3 -m app.auth.cli init                 # create users.yaml on first start
    python3 -m app.auth.cli reset-password NAME  # issue a new one-time password
"""

from __future__ import annotations

import argparse
import os
import secrets
import sys

import bcrypt
import yaml

from ..config import get_settings
from ..fileutil import write_private_text
from .users import MAX_PASSWORD_LENGTH, UserStore, hash_password


def _banner(username: str, password: str) -> None:
    print("=" * 60, flush=True)
    print(f"  DUI login   user: {username}   password: {password}", flush=True)
    print("  You will be asked to change this password after signing in.", flush=True)
    print("=" * 60, flush=True)


# Passwords older releases shipped or created: admin/dui (users.yaml template) and admin/admin
# (the removed /api/auth/bootstrap endpoint). Anyone who read the README knows them.
KNOWN_DEFAULT_PASSWORDS = ("dui", "admin")


def flag_default_passwords() -> int:
    """On upgrade, force a password change for any account still using a published default."""
    settings = get_settings()
    data = yaml.safe_load(settings.users_yaml.read_text(encoding="utf-8")) or {}
    users = list(data.get("users") or [])
    flagged = []
    for user in users:
        password_hash = str(user.get("password_hash", "")).encode()
        if user.get("must_change_password") or not password_hash:
            continue
        if any(bcrypt.checkpw(pw.encode(), password_hash) for pw in KNOWN_DEFAULT_PASSWORDS):
            user["must_change_password"] = True
            user["session_version"] = int(user.get("session_version", 0)) + 1
            flagged.append(str(user.get("username")))
    if flagged:
        data["users"] = users
        write_private_text(settings.users_yaml, yaml.safe_dump(data, sort_keys=False))
        print(
            f"DUI WARNING: {', '.join(flagged)} still used a published default password; "
            "a password change will be required at next sign-in",
            file=sys.stderr,
            flush=True,
        )
    return 0


def init_users() -> int:
    settings = get_settings()
    path = settings.users_yaml
    if path.exists():
        return flag_default_passwords()
    password = os.environ.get("DUI_ADMIN_PASSWORD", "")
    generated = not password
    if generated:
        password = secrets.token_urlsafe(12)
    elif len(password.encode()) > MAX_PASSWORD_LENGTH:
        print(f"DUI_ADMIN_PASSWORD must be at most {MAX_PASSWORD_LENGTH} bytes", file=sys.stderr)
        return 1
    entry = {"username": "admin", "role": "admin", "password_hash": hash_password(password), "session_version": 0}
    if generated:
        entry["must_change_password"] = True
    data = {"users": [entry], "session": {"ttl_hours": settings.session_ttl_hours}}
    write_private_text(path, yaml.safe_dump(data, sort_keys=False))
    if generated:
        _banner("admin", password)
    else:
        print("DUI: created admin user from DUI_ADMIN_PASSWORD", flush=True)
    return 0


def reset_password(username: str) -> int:
    store = UserStore()
    data = store.load()
    users = list(data.get("users") or [])
    for user in users:
        if user.get("username") == username:
            password = secrets.token_urlsafe(12)
            user["password_hash"] = hash_password(password)
            user["session_version"] = int(user.get("session_version", 0)) + 1
            user["must_change_password"] = True
            data["users"] = users
            write_private_text(store.settings.users_yaml, yaml.safe_dump(data, sort_keys=False))
            _banner(username, password)
            return 0
    print(f"User {username} not found", file=sys.stderr)
    return 1


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python3 -m app.auth.cli")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("init", help="create users.yaml with an admin account if it does not exist")
    reset = sub.add_parser("reset-password", help="set a new one-time password for a user")
    reset.add_argument("username")
    args = parser.parse_args(argv)
    if args.command == "init":
        return init_users()
    return reset_password(args.username)


if __name__ == "__main__":
    sys.exit(main())
