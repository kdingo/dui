from __future__ import annotations

from fastapi import Depends, HTTPException, Request, status

from .users import SessionManager, UserStore


async def get_current_user(request: Request) -> dict[str, str]:
    token = request.cookies.get("dui_session")
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    session = SessionManager().load_session(token)
    return session


async def require_admin(user: dict[str, str] = Depends(get_current_user)) -> dict[str, str]:
    if user.get("role") != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required")
    return user


async def get_csrf_token(request: Request) -> str:
    token = request.cookies.get("dui_csrf")
    if not token:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Missing CSRF token")
    return token


async def verify_csrf(request: Request) -> None:
    cookie = request.cookies.get("dui_csrf")
    header = request.headers.get("x-csrf-token")
    if not cookie or not header or cookie != header:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="CSRF validation failed")
