from __future__ import annotations

from typing import Any

from fastapi import Depends, Request, status

from ..errors import AppError

from .users import SessionManager, UserStore

# Endpoints a user who must change their password may still reach.
PASSWORD_CHANGE_ALLOWED_PATHS = {"/api/auth/me", "/api/auth/password", "/api/auth/password-policy"}


async def get_current_user(request: Request) -> dict[str, Any]:
    token = request.cookies.get("dui_session")
    if not token:
        raise AppError("auth.not_authenticated", status.HTTP_401_UNAUTHORIZED)
    session = SessionManager().load_session(token)
    # Look the user up on every request so deletes, demotions and logouts take effect immediately.
    user = UserStore().get_user(str(session.get("username", "")))
    if user is None or session.get("ver") != user.session_version:
        raise AppError("auth.invalid_session", status.HTTP_401_UNAUTHORIZED)
    if user.must_change_password and request.url.path not in PASSWORD_CHANGE_ALLOWED_PATHS:
        raise AppError("auth.password_change_required", status.HTTP_403_FORBIDDEN)
    return {
        "username": user.username,
        "role": user.role,
        "must_change_password": user.must_change_password,
    }


async def require_admin(user: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
    if user.get("role") != "admin":
        raise AppError("auth.admin_required", status.HTTP_403_FORBIDDEN)
    return user


async def verify_csrf(request: Request) -> None:
    # Browsers send Sec-Fetch-Site; reject anything not from this exact origin. This also blocks
    # other ports on the same host, which count as "same-site" for SameSite cookies.
    fetch_site = request.headers.get("sec-fetch-site")
    if fetch_site and fetch_site not in {"same-origin", "none"}:
        raise AppError("auth.cross_site", status.HTTP_403_FORBIDDEN)
    cookie = request.cookies.get("dui_csrf")
    header = request.headers.get("x-csrf-token")
    if not cookie or not header or cookie != header:
        raise AppError("auth.csrf_failed", status.HTTP_403_FORBIDDEN)
