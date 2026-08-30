from __future__ import annotations

import secrets

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel, Field

from ..auth.deps import get_current_user, require_admin, verify_csrf
from ..auth.users import LoginRateLimiter, SessionManager, UserStore, get_client_ip, hash_password
from ..config import get_settings

router = APIRouter(prefix="/api/auth", tags=["auth"])
rate_limiter = LoginRateLimiter(
    max_attempts=get_settings().login_rate_limit,
    window_seconds=get_settings().login_rate_window_seconds,
)


class LoginRequest(BaseModel):
    username: str
    password: str


class LoginResponse(BaseModel):
    username: str
    role: str
    csrf_token: str


@router.post("/login", response_model=LoginResponse)
async def login(payload: LoginRequest, request: Request, response: Response) -> LoginResponse:
    ip = get_client_ip(request)
    rate_limiter.check(ip)
    user = UserStore().verify_password(payload.username, payload.password)
    if not user:
        rate_limiter.record_failure(ip)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    rate_limiter.reset(ip)
    session = SessionManager().create_session_token(user.username, user.role)
    csrf = secrets.token_urlsafe(32)
    response.set_cookie(
        "dui_session",
        session,
        httponly=True,
        samesite="strict",
        secure=False,
        max_age=get_settings().session_ttl_hours * 3600,
        path="/",
    )
    response.set_cookie("dui_csrf", csrf, httponly=False, samesite="strict", path="/")
    return LoginResponse(username=user.username, role=user.role, csrf_token=csrf)


@router.post("/logout")
async def logout(response: Response, _: None = Depends(verify_csrf)) -> dict[str, str]:
    response.delete_cookie("dui_session", path="/")
    response.delete_cookie("dui_csrf", path="/")
    return {"status": "ok"}


@router.get("/me")
async def me(user: dict[str, str] = Depends(get_current_user)) -> dict[str, str]:
    csrf = secrets.token_urlsafe(16)
    return {"username": user["username"], "role": user["role"], "csrf_token": ""}


class UserUpdate(BaseModel):
    username: str
    role: Literal["admin", "viewer"]
    password: str | None = None


class UsersUpdateRequest(BaseModel):
    users: list[UserUpdate]


class UserCreateRequest(BaseModel):
    username: str
    role: Literal["admin", "viewer"]
    password: str = Field(min_length=1)


class UserPatchRequest(BaseModel):
    role: Literal["admin", "viewer"] | None = None
    password: str | None = None


@router.get("/users")
async def list_users(_: dict[str, str] = Depends(require_admin)) -> dict[str, list]:
    return {"users": UserStore().list_users()}


@router.put("/users")
async def update_users(
    payload: UsersUpdateRequest,
    _: dict[str, str] = Depends(require_admin),
    __: None = Depends(verify_csrf),
) -> dict[str, list]:
    password_hashes: dict[str, str] = {}
    for user in payload.users:
        if user.password:
            password_hashes[user.username] = hash_password(user.password)
    UserStore().save_users([u.model_dump(exclude={"password"}) for u in payload.users], password_hashes)
    return {"users": UserStore().list_users()}


@router.post("/users")
async def create_user(
    payload: UserCreateRequest,
    _: dict[str, str] = Depends(require_admin),
    __: None = Depends(verify_csrf),
) -> dict[str, list]:
    UserStore().create_user(payload.username, payload.password, payload.role)
    return {"users": UserStore().list_users()}


@router.patch("/users/{username}")
async def patch_user(
    username: str,
    payload: UserPatchRequest,
    _: dict[str, str] = Depends(require_admin),
    __: None = Depends(verify_csrf),
) -> dict[str, list]:
    if payload.role is None and not payload.password:
        raise HTTPException(status_code=400, detail="No changes provided")
    UserStore().update_user(username, role=payload.role, password=payload.password)
    return {"users": UserStore().list_users()}


@router.delete("/users/{username}")
async def delete_user(
    username: str,
    _: dict[str, str] = Depends(require_admin),
    __: None = Depends(verify_csrf),
) -> dict[str, list]:
    UserStore().delete_user(username)
    return {"users": UserStore().list_users()}


@router.post("/bootstrap")
async def bootstrap_admin(request: Request, response: Response) -> LoginResponse:
    """Create initial admin if no users file exists yet."""
    settings = get_settings()
    if settings.users_yaml.exists():
        raise HTTPException(status_code=400, detail="Users already configured")
    default_password = "admin"
    settings.users_yaml.parent.mkdir(parents=True, exist_ok=True)
    settings.users_yaml.write_text(
        "users:\n"
        f"  - username: admin\n"
        f"    password_hash: \"{hash_password(default_password)}\"\n"
        "    role: admin\n"
        "session:\n"
        "  ttl_hours: 24\n",
        encoding="utf-8",
    )
    payload = LoginRequest(username="admin", password=default_password)
    return await login(payload, request, response)
