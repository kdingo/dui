from __future__ import annotations

import logging

import yaml
from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from ..auth.deps import get_current_user, require_admin, verify_csrf
from ..config import get_settings
from ..errors import AppError
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
    name = settings.server_name
    if settings.server_yaml.exists():
        data = yaml.safe_load(settings.server_yaml.read_text(encoding="utf-8")) or {}
        name = data.get("name", name)
    return {
        "name": name,
        "interface": settings.interface,
        "http_port": settings.http_port,
        "data_dir": str(settings.data_dir),
    }


class ServerNameUpdate(BaseModel):
    name: str = Field(min_length=1, max_length=128)


@router.put("/server")
async def update_server_name(
    payload: ServerNameUpdate,
    _: dict[str, str] = Depends(require_admin),
    __: None = Depends(verify_csrf),
) -> dict:
    settings = get_settings()
    settings.server_yaml.write_text(yaml.safe_dump({"name": payload.name}), encoding="utf-8")
    return {"name": payload.name}


@router.get("/dhcp/status")
async def dhcp_status(_: dict[str, str] = Depends(get_current_user)) -> dict:
    return dhcp_service_status(get_settings())


@router.post("/dhcp/{action}")
async def dhcp_control(
    action: str,
    _: dict[str, str] = Depends(require_admin),
    __: None = Depends(verify_csrf),
) -> dict[str, str]:
    if action not in {"start", "stop", "restart"}:
        raise AppError("dhcp.invalid_action")
    try:
        control_dhcp_service(get_settings(), action)
    except Exception as exc:
        logger.exception("dhcp %s failed", action)
        raise AppError(f"dhcp.{action}_failed", 500) from exc
    return {"status": action}


@router.post("/container/stop")
async def container_stop(
    _: dict[str, str] = Depends(require_admin),
    __: None = Depends(verify_csrf),
) -> dict[str, str]:
    stop_container()
    return {"status": "stopping"}


@router.post("/container/restart")
async def container_restart(
    _: dict[str, str] = Depends(require_admin),
    __: None = Depends(verify_csrf),
) -> dict[str, str]:
    restart_container()
    return {"status": "restarting"}
