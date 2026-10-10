"""Coded API errors.

Every message the API can show a user has a stable code here. Responses carry the code and its
params next to the English ``detail``, and the frontend translates them from its locale files
(``frontend/src/locales/<lang>/translation.json`` under ``server.<code>``). Adding a message:
add the code below, raise it, then add the English text to ``locales/en`` (``npm run i18n:check``
in the frontend lists codes missing from a locale).
"""

from __future__ import annotations

from typing import Any

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import ValidationError
from pydantic_core import PydanticCustomError

# English templates; ``{name}`` placeholders are filled from the error's params.
MESSAGES: dict[str, str] = {
    # auth
    "auth.not_authenticated": "Not authenticated",
    "auth.invalid_session": "Invalid session",
    "auth.session_expired": "Session expired",
    "auth.password_change_required": "Password change required",
    "auth.admin_required": "Admin access required",
    "auth.cross_site": "Cross-site request blocked",
    "auth.csrf_failed": "CSRF validation failed",
    "auth.invalid_credentials": "Invalid credentials",
    "auth.rate_limited": "Too many login attempts. Try again later.",
    # users
    "user.admin_required": "At least one admin user is required",
    "user.missing_password": "Missing password for new user {username}",
    "user.username_required": "Username is required",
    "user.password_required": "Password is required",
    "user.exists": "User {username} already exists",
    "user.not_found": "User not found",
    "user.current_password_incorrect": "Current password is incorrect",
    "user.password_unchanged": "New password must differ from the current one",
    "user.no_changes": "No changes provided",
    "password.too_long": "Password must be at most {max} bytes",
    # DHCP service
    "dhcp.invalid_action": "Invalid action",
    "dhcp.start_failed": "Failed to start dhcpd",
    "dhcp.stop_failed": "Failed to stop dhcpd",
    "dhcp.restart_failed": "Failed to restart dhcpd",
    "dhcp.validation_failed": "dhcpd configuration validation failed",
    # configuration
    "config.invalid": "Invalid configuration: {errors}",
    "config.subnet_not_found": "Subnet not found",
    "config.host_not_found": "Host not found",
    "config.unsupported_block": "Unsupported dhcpd.conf block: {line}",
    "config.unsafe_option_value": "unsafe option value '{value}'",
    "config.unsupported_option_value": "unsupported option value '{value}'",
    # import / export
    "import.zip_too_large": "Zip file is too large",
    "import.zip_invalid": "Invalid zip file",
    "import.zip_too_many_entries": "Zip archive has too many entries",
    "import.zip_contents_too_large": "Zip archive is too large",
    "import.zip_missing_conf": "Zip archive is missing dhcpd.conf",
    "import.zip_unsafe_path": "Unsafe zip member path: {name}",
    "import.server_yaml_invalid": "server.yaml in the zip is not valid YAML",
    "import.server_yaml_name": "server.yaml in the zip must contain a short 'name'",
    # snapshots
    "snapshot.not_found": "Snapshot {id} not found",
    "snapshot.empty": "Snapshot {id} is empty",
    "snapshot.no_conf": "Snapshot {id} has no dhcpd.conf",
    "snapshot.invalid_config": "Snapshot contains invalid configuration: {reason}",
    # syslog
    "syslog.host_required": "Enter a syslog server to enable syslog",
    "syslog.send_failed": "Could not send to the syslog server: {reason}",
    # field validation (raised inside pydantic models, so they also appear as 422 item types)
    "validation.cidr": "network must be an IPv4 CIDR (e.g. 192.168.1.0/24)",
    "validation.ipv4": "'{value}' is not a valid IPv4 address",
    "validation.host_name": "host name may only contain letters, digits, '.', '_' and '-'",
    "validation.mac": "'{value}' is not a valid MAC address (aa:bb:cc:dd:ee:ff)",
    "validation.fixed_address": "'{value}' is not a valid IPv4 address or hostname",
    "validation.unsafe_string": (
        "'{value}' contains characters not allowed in dhcpd.conf "
        "(quotes, backslash, ';', braces, '#' or control characters)"
    ),
    "validation.syslog_host": "'{value}' is not a valid hostname or IP address",
    "validation.option_value": "option values must be strings, numbers, booleans or flat lists of those",
    "validation.option_name": "invalid option name '{name}'",
    "validation.statement": "unsupported dhcpd.conf statement: '{value}'",
    "validation.ddns_update_style": "ddns-update-style must be one of {choices}",
    "validation.log_facility": "log-facility must be one of {choices}",
}


def format_message(code: str, params: dict[str, Any] | None = None) -> str:
    return MESSAGES[code].format(**(params or {}))


def coded(code: str, **params: Any) -> PydanticCustomError:
    """A ValueError carrying ``code``; inside a pydantic model it becomes a 422 item of that type."""
    return PydanticCustomError(code, MESSAGES[code], params)


class CodedNotFound(FileNotFoundError):
    def __init__(self, code: str, **params: Any):
        super().__init__(format_message(code, params))
        self.code = code
        self.params = params


class AppError(HTTPException):
    """An HTTPException whose response also carries ``code`` and ``params`` for translation."""

    def __init__(
        self,
        code: str,
        status_code: int = 400,
        *,
        detail: str | None = None,
        errors: list[dict[str, Any]] | None = None,
        cause: AppError | None = None,
        **params: Any,
    ):
        super().__init__(status_code=status_code, detail=detail or format_message(code, params))
        self.code = code
        self.params = params
        self.errors = errors
        self.cause = cause

    def body(self) -> dict[str, Any]:
        body: dict[str, Any] = {"detail": self.detail, "code": self.code, "params": self.params}
        if self.errors is not None:
            body["errors"] = self.errors
        if self.cause is not None:
            body["cause"] = self.cause.body()
        return body


def _jsonable(value: Any) -> Any:
    return value if isinstance(value, (str, int, float, bool, type(None))) else str(value)


def validation_items(exc: ValidationError) -> list[dict[str, Any]]:
    """Pydantic errors in the same shape FastAPI uses for 422 responses."""
    return [
        {
            "loc": list(err["loc"]),
            "type": err["type"],
            "msg": err["msg"],
            "ctx": {k: _jsonable(v) for k, v in (err.get("ctx") or {}).items()},
        }
        for err in exc.errors()
    ]


def to_http(exc: Exception, status_code: int = 400) -> AppError | HTTPException:
    """Convert a domain error into an HTTP error, keeping its code when it has one."""
    if isinstance(exc, AppError):
        return exc
    if isinstance(exc, ValidationError):
        items = validation_items(exc)
        joined = "; ".join(
            f"{'.'.join(str(p) for p in item['loc'])}: {item['msg']}" if item["loc"] else item["msg"] for item in items
        )
        return AppError("config.invalid", status_code, detail=format_message("config.invalid", {"errors": joined}), errors=items)
    if isinstance(exc, PydanticCustomError) and exc.type in MESSAGES:
        return AppError(exc.type, status_code, **(exc.context or {}))
    code = getattr(exc, "code", None)
    if code in MESSAGES:
        return AppError(code, status_code, **getattr(exc, "params", {}))
    return HTTPException(status_code=status_code, detail=str(exc))


async def _app_error_handler(_: Request, exc: Exception) -> JSONResponse:
    assert isinstance(exc, AppError)
    return JSONResponse(exc.body(), status_code=exc.status_code, headers=exc.headers)


def register_handlers(app: FastAPI) -> None:
    app.add_exception_handler(AppError, _app_error_handler)

