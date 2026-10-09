from __future__ import annotations

import asyncio
import logging

import yaml
from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field

from ..auth.deps import get_current_user, require_admin, verify_csrf
from ..config import get_settings, load_server_name
from ..errors import AppError
from ..syslog import (
    Severity,
    SyslogConfig,
    audit,
    emitter,
    load_syslog_config,
    save_syslog_config,
    send_now,
)
from ..dhcp.manager import (
    control_dhcp_service,
    dhcp_service_status,
    restart_container,
    stop_container,
)

router = APIRouter(prefix="/api/admin", tags=["admin"])
logger = logging.getLogger(__name__)


@router.get("/server")
async def get_server_info(_: dict[str, str] = Depends(get_current_user)) -> dict:
    settings = get_settings()
    return {
        "name": load_server_name(settings),
        "interface": settings.interface,
        "http_port": settings.http_port,
        "data_dir": str(settings.data_dir),
    }


class ServerNameUpdate(BaseModel):
    name: str = Field(min_length=1, max_length=128)


@router.put("/server")
async def update_server_name(
    payload: ServerNameUpdate,
    request: Request,
    user: dict[str, str] = Depends(require_admin),
    __: None = Depends(verify_csrf),
) -> dict:
    settings = get_settings()
    settings.server_yaml.write_text(yaml.safe_dump({"name": payload.name}), encoding="utf-8")
    audit("server", "SETTINGS", f"Server name changed to {payload.name!r}", request=request, user=user,
          action="server_name", name=payload.name)
    return {"name": payload.name}


@router.get("/dhcp/status")
async def dhcp_status(_: dict[str, str] = Depends(get_current_user)) -> dict:
    return dhcp_service_status(get_settings())


@router.post("/dhcp/{action}")
async def dhcp_control(
    action: str,
    request: Request,
    user: dict[str, str] = Depends(require_admin),
    __: None = Depends(verify_csrf),
) -> dict[str, str]:
    if action not in {"start", "stop", "restart"}:
        raise AppError("dhcp.invalid_action")
    try:
        control_dhcp_service(get_settings(), action)
    except Exception as exc:
        logger.exception("dhcp %s failed", action)
        audit("server", "SERVICE", f"dhcpd {action} failed", request=request, user=user,
              severity=Severity.ERROR, action=f"dhcp_{action}")
        raise AppError(f"dhcp.{action}_failed", 500) from exc
    audit("server", "SERVICE", f"dhcpd {action} requested", request=request, user=user,
          severity=Severity.NOTICE, action=f"dhcp_{action}")
    return {"status": action}


@router.post("/container/stop")
async def container_stop(
    request: Request,
    user: dict[str, str] = Depends(require_admin),
    __: None = Depends(verify_csrf),
) -> dict[str, str]:
    audit("server", "SERVICE", "Container stop requested", request=request, user=user,
          severity=Severity.NOTICE, action="container_stop")
    # Let the message leave before PID 1 takes the API down.
    emitter.flush()
    stop_container()
    return {"status": "stopping"}


@router.post("/container/restart")
async def container_restart(
    request: Request,
    user: dict[str, str] = Depends(require_admin),
    __: None = Depends(verify_csrf),
) -> dict[str, str]:
    audit("server", "SERVICE", "Container restart requested", request=request, user=user,
          severity=Severity.NOTICE, action="container_restart")
    # Let the message leave before PID 1 takes the API down.
    emitter.flush()
    restart_container()
    return {"status": "restarting"}


@router.get("/syslog", response_model=SyslogConfig)
async def get_syslog(_: dict[str, str] = Depends(require_admin)) -> SyslogConfig:
    return load_syslog_config()


@router.put("/syslog", response_model=SyslogConfig)
async def update_syslog(
    payload: SyslogConfig,
    request: Request,
    user: dict[str, str] = Depends(require_admin),
    __: None = Depends(verify_csrf),
) -> SyslogConfig:
    save_syslog_config(payload)
    emitter.reconfigure(payload)
    # Goes to the new target, so the collector sees what it is now receiving.
    audit("server", "SETTINGS", "Syslog settings changed", request=request, user=user, action="syslog",
          target=f"{payload.host}:{payload.port}/{payload.protocol}",
          categories=",".join(c for c in ("leases", "server", "users") if getattr(payload, c)))
    return payload


@router.post("/syslog/test")
async def test_syslog(
    payload: SyslogConfig,
    user: dict[str, str] = Depends(require_admin),
    __: None = Depends(verify_csrf),
) -> dict[str, str]:
    # Uses the submitted (possibly unsaved) settings so admins can check them before saving.
    if not payload.host:
        raise AppError("syslog.host_required")
    try:
        await asyncio.to_thread(
            send_now, payload, Severity.NOTICE, "TEST", "DUI syslog test message", user=user["username"]
        )
    except OSError as exc:
        raise AppError("syslog.send_failed", 502, reason=str(exc) or type(exc).__name__) from exc
    return {"status": "sent"}
