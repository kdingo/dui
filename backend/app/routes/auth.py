from __future__ import annotations

import secrets

from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel, Field

from ..auth.deps import get_current_user, require_admin, verify_csrf
from ..auth.users import (
    USERNAME_PATTERN,
    LoginRateLimiter,
    SessionManager,
    UserRecord,
    UserStore,
    get_client_ip,
    hash_password,
)
from ..auth.policy import PasswordPolicy, load_policy, save_policy
from ..config import get_settings
from ..errors import AppError
from ..syslog import Severity, audit

router = APIRouter(prefix="/api/auth", tags=["auth"])
rate_limiter = LoginRateLimiter(
    max_attempts=get_settings().login_rate_limit,
    window_seconds=get_settings().login_rate_window_seconds,
)
# Per-username limit is looser than per-IP so one noisy client can't lock an account out too easily.
USERNAME_ATTEMPT_MULTIPLIER = 4

Username = Annotated[str, Field(pattern=USERNAME_PATTERN)]
# Strength rules come from the admin-chosen policy (auth/policy.py), checked in each handler.
NewPassword = Annotated[str, Field(min_length=1, max_length=1024)]


class LoginRequest(BaseModel):
    username: str = Field(max_length=128)
    password: str = Field(max_length=1024)


class LoginResponse(BaseModel):
    username: str
    role: str
    csrf_token: str
    must_change_password: bool = False


def _issue_session(response: Response, user: UserRecord) -> str:
    settings = get_settings()
    session = SessionManager().create_session_token(user.username, user.session_version)
    csrf = secrets.token_urlsafe(32)
    response.set_cookie(
        "dui_session",
        session,
        httponly=True,
        samesite="strict",
        secure=settings.secure_cookies,
        max_age=settings.session_ttl_hours * 3600,
        path="/",
    )
    response.set_cookie(
        "dui_csrf",
        csrf,
        httponly=False,
        samesite="strict",
        secure=settings.secure_cookies,
        path="/",
    )
    return csrf


@router.post("/login", response_model=LoginResponse)
async def login(payload: LoginRequest, request: Request, response: Response) -> LoginResponse:
    ip_key = f"ip:{get_client_ip(request)}"
    user_key = f"user:{payload.username.strip().lower()}"
    try:
        rate_limiter.check(ip_key)
        rate_limiter.check(user_key, rate_limiter.max_attempts * USERNAME_ATTEMPT_MULTIPLIER)
    except AppError:
        audit("users", "AUTH", f"Login blocked by rate limit for {payload.username!r}", request=request,
              user=payload.username, severity=Severity.WARNING, action="login_rate_limited")
        raise
    user = UserStore().verify_password(payload.username, payload.password)
    if not user:
        rate_limiter.record_failure(ip_key)
        rate_limiter.record_failure(user_key)
        audit("users", "AUTH", f"Failed login for {payload.username!r}", request=request,
              user=payload.username, severity=Severity.WARNING, action="login_failed")
        raise AppError("auth.invalid_credentials", status.HTTP_401_UNAUTHORIZED)
    rate_limiter.reset(ip_key)
    rate_limiter.reset(user_key)
    csrf = _issue_session(response, user)
    audit("users", "AUTH", f"{user.username} logged in", request=request, user=user.username, action="login")
    return LoginResponse(
        username=user.username,
        role=user.role,
        csrf_token=csrf,
        must_change_password=user.must_change_password,
    )


@router.post("/logout")
async def logout(request: Request, response: Response, _: None = Depends(verify_csrf)) -> dict[str, str]:
    token = request.cookies.get("dui_session")
    if token:
        try:
            session = SessionManager().load_session(token)
            username = str(session.get("username", ""))
            # Revoke server-side so a copied cookie stops working too.
            UserStore().bump_session_version(username)
            audit("users", "AUTH", f"{username} logged out", request=request, user=username, action="logout")
        except HTTPException:
            pass
    response.delete_cookie("dui_session", path="/")
    response.delete_cookie("dui_csrf", path="/")
    return {"status": "ok"}


@router.get("/me")
async def me(user: dict = Depends(get_current_user)) -> dict:
    return {
        "username": user["username"],
        "role": user["role"],
        "must_change_password": user["must_change_password"],
        "csrf_token": "",
    }


class PasswordChangeRequest(BaseModel):
    current_password: str = Field(max_length=1024)
    new_password: NewPassword


@router.post("/password", response_model=LoginResponse)
async def change_password(
    payload: PasswordChangeRequest,
    request: Request,
    response: Response,
    user: dict = Depends(get_current_user),
    __: None = Depends(verify_csrf),
) -> LoginResponse:
    load_policy().enforce(payload.new_password, user["username"])
    try:
        record = UserStore().change_own_password(user["username"], payload.current_password, payload.new_password)
    except AppError as exc:
        if exc.code == "user.current_password_incorrect":
            audit("users", "AUTH", f"{user['username']} gave a wrong current password when changing it",
                  request=request, user=user, severity=Severity.WARNING, action="password_change_failed")
        raise
    audit("users", "AUTH", f"{user['username']} changed their password", request=request, user=user,
          action="password_change")
    # The change revoked every session, including this one; hand back a fresh one.
    csrf = _issue_session(response, record)
    return LoginResponse(username=record.username, role=record.role, csrf_token=csrf)


class UserUpdate(BaseModel):
    username: Username
    role: Literal["admin", "viewer"]
    password: NewPassword | None = None


class UsersUpdateRequest(BaseModel):
    users: list[UserUpdate]


class UserCreateRequest(BaseModel):
    username: Username
    role: Literal["admin", "viewer"]
    password: NewPassword


class UserPatchRequest(BaseModel):
    role: Literal["admin", "viewer"] | None = None
    password: NewPassword | None = None


@router.get("/password-policy", response_model=PasswordPolicy)
async def get_password_policy(_: dict = Depends(get_current_user)) -> PasswordPolicy:
    # Readable by every signed-in user so password forms can show the rules.
    return load_policy()


@router.put("/password-policy", response_model=PasswordPolicy)
async def update_password_policy(
    payload: PasswordPolicy,
    request: Request,
    user: dict = Depends(require_admin),
    __: None = Depends(verify_csrf),
) -> PasswordPolicy:
    save_policy(payload)
    audit("server", "SETTINGS", "Password policy changed", request=request, user=user, action="password_policy",
          **{k: str(v).lower() for k, v in payload.model_dump().items()})
    return payload


@router.get("/users")
async def list_users(_: dict = Depends(require_admin)) -> dict[str, list]:
    return {"users": UserStore().list_users()}


@router.put("/users")
async def update_users(
    payload: UsersUpdateRequest,
    request: Request,
    user: dict = Depends(require_admin),
    __: None = Depends(verify_csrf),
) -> dict[str, list]:
    policy = load_policy()
    password_hashes: dict[str, str] = {}
    for entry in payload.users:
        if entry.password:
            policy.enforce(entry.password, entry.username)
            password_hashes[entry.username] = hash_password(entry.password)
    UserStore().save_users([u.model_dump(exclude={"password"}) for u in payload.users], password_hashes)
    audit("users", "USER", "User list replaced", request=request, user=user, action="users_replace",
          users=",".join(f"{u.username}:{u.role}" for u in payload.users),
          password_resets=",".join(password_hashes))
    return {"users": UserStore().list_users()}


@router.post("/users")
async def create_user(
    payload: UserCreateRequest,
    request: Request,
    user: dict = Depends(require_admin),
    __: None = Depends(verify_csrf),
) -> dict[str, list]:
    load_policy().enforce(payload.password, payload.username)
    UserStore().create_user(payload.username, payload.password, payload.role)
    audit("users", "USER", f"User {payload.username} created ({payload.role})", request=request, user=user,
          action="user_create", target=payload.username, role=payload.role)
    return {"users": UserStore().list_users()}


@router.patch("/users/{username}")
async def patch_user(
    username: str,
    payload: UserPatchRequest,
    request: Request,
    user: dict = Depends(require_admin),
    __: None = Depends(verify_csrf),
) -> dict[str, list]:
    if payload.role is None and not payload.password:
        raise AppError("user.no_changes")
    if payload.password:
        load_policy().enforce(payload.password, username)
    UserStore().update_user(username, role=payload.role, password=payload.password)
    changes = [f"role={payload.role}"] if payload.role else []
    if payload.password:
        changes.append("password reset")
    audit("users", "USER", f"User {username} updated: {', '.join(changes)}", request=request, user=user,
          action="user_update", target=username, role=payload.role,
          password_reset="true" if payload.password else None)
    return {"users": UserStore().list_users()}


@router.delete("/users/{username}")
async def delete_user(
    username: str,
    request: Request,
    user: dict = Depends(require_admin),
    __: None = Depends(verify_csrf),
) -> dict[str, list]:
    UserStore().delete_user(username)
    audit("users", "USER", f"User {username} deleted", request=request, user=user, action="user_delete",
          target=username)
    return {"users": UserStore().list_users()}
