from __future__ import annotations

import uuid
from typing import Any

from fastapi import APIRouter, Depends, File, Request, Response, UploadFile
from pydantic import BaseModel, Field

from ..auth.deps import get_current_user, require_admin, verify_csrf
from ..dhcp.manager import ConfigManager, DhcpValidationError
from ..errors import AppError, to_http
from ..syslog import Severity, audit
from ..dhcp.models import (
    DhcpConfig,
    DhcpHost,
    DhcpOptions,
    DhcpRange,
    DhcpSubnet,
    FixedAddress,
    HostName,
    IPv4Cidr,
    MacAddress,
)

router = APIRouter(prefix="/api/config", tags=["config"])

MAX_ZIP_UPLOAD_BYTES = 2 * 1024 * 1024


def _save_and_audit(
    manager: ConfigManager,
    config: DhcpConfig,
    request: Request,
    user: dict[str, str],
    message: str,
    **params: Any,
) -> None:
    try:
        manager.save_config(config, apply=True)
    except DhcpValidationError as exc:
        audit("server", "CONFIG", f"{message} rejected: dhcpd validation failed", request=request, user=user,
              severity=Severity.WARNING, **params)
        raise to_http(exc) from exc
    audit("server", "CONFIG", message, request=request, user=user, severity=Severity.NOTICE, **params)


@router.get("")
async def get_config(_: dict[str, str] = Depends(get_current_user)) -> DhcpConfig:
    return ConfigManager().load_config()


@router.put("")
async def replace_config(
    config: DhcpConfig,
    request: Request,
    user: dict[str, str] = Depends(require_admin),
    __: None = Depends(verify_csrf),
) -> DhcpConfig:
    manager = ConfigManager()
    _save_and_audit(manager, config, request, user, "DHCP configuration replaced", action="config_replace")
    return manager.load_config()


@router.post("/apply")
async def apply_config(
    request: Request,
    user: dict[str, str] = Depends(require_admin),
    __: None = Depends(verify_csrf),
) -> dict[str, str]:
    manager = ConfigManager()
    try:
        manager.apply_config()
    except DhcpValidationError as exc:
        audit("server", "CONFIG", "DHCP configuration apply rejected: dhcpd validation failed", request=request,
              user=user, severity=Severity.WARNING, action="config_apply")
        raise to_http(exc) from exc
    audit("server", "CONFIG", "DHCP configuration applied", request=request, user=user,
          severity=Severity.NOTICE, action="config_apply")
    return {"status": "applied"}


class SubnetPayload(BaseModel):
    network: IPv4Cidr
    name: str | None = Field(default=None, max_length=128)
    range: DhcpRange | None = None
    options: DhcpOptions = Field(default_factory=dict)


def _subnet_params(subnet: DhcpSubnet) -> dict[str, Any]:
    return {
        "target": subnet.id,
        "network": subnet.network,
        "name": subnet.name,
        "range": f"{subnet.range.start}-{subnet.range.end}" if subnet.range else None,
    }


@router.post("/subnets")
async def add_subnet(
    payload: SubnetPayload,
    request: Request,
    user: dict[str, str] = Depends(require_admin),
    __: None = Depends(verify_csrf),
) -> DhcpConfig:
    manager = ConfigManager()
    config = manager.load_config()
    subnet = DhcpSubnet(id=f"subnet-{uuid.uuid4().hex[:8]}", **payload.model_dump())
    config.subnets.append(subnet)
    _save_and_audit(manager, config, request, user, f"Subnet {subnet.network} added", action="subnet_add",
                    **_subnet_params(subnet))
    return config


@router.put("/subnets/{subnet_id}")
async def update_subnet(
    subnet_id: str,
    payload: SubnetPayload,
    request: Request,
    user: dict[str, str] = Depends(require_admin),
    __: None = Depends(verify_csrf),
) -> DhcpConfig:
    manager = ConfigManager()
    config = manager.load_config()
    for idx, subnet in enumerate(config.subnets):
        if subnet.id == subnet_id:
            config.subnets[idx] = subnet = DhcpSubnet(id=subnet_id, **payload.model_dump())
            break
    else:
        raise AppError("config.subnet_not_found", 404)
    _save_and_audit(manager, config, request, user, f"Subnet {subnet.network} updated", action="subnet_update",
                    **_subnet_params(subnet))
    return config


@router.delete("/subnets/{subnet_id}")
async def delete_subnet(
    subnet_id: str,
    request: Request,
    user: dict[str, str] = Depends(require_admin),
    __: None = Depends(verify_csrf),
) -> DhcpConfig:
    manager = ConfigManager()
    config = manager.load_config()
    removed = [s for s in config.subnets if s.id == subnet_id]
    config.subnets = [s for s in config.subnets if s.id != subnet_id]
    label = removed[0].network if removed else subnet_id
    _save_and_audit(manager, config, request, user, f"Subnet {label} deleted", action="subnet_delete",
                    **(_subnet_params(removed[0]) if removed else {"target": subnet_id}))
    return config


class HostPayload(BaseModel):
    name: HostName
    hardware_address: MacAddress
    fixed_address: FixedAddress
    options: DhcpOptions = Field(default_factory=dict)


def _host_params(host: DhcpHost) -> dict[str, Any]:
    return {"target": host.id, "name": host.name, "mac": host.hardware_address, "address": host.fixed_address}


@router.post("/hosts")
async def add_host(
    payload: HostPayload,
    request: Request,
    user: dict[str, str] = Depends(require_admin),
    __: None = Depends(verify_csrf),
) -> DhcpConfig:
    manager = ConfigManager()
    config = manager.load_config()
    host = DhcpHost(id=f"host-{uuid.uuid4().hex[:8]}", **payload.model_dump())
    config.hosts.append(host)
    _save_and_audit(manager, config, request, user, f"Fixed client {host.name} added", action="host_add",
                    **_host_params(host))
    return config


@router.put("/hosts/{host_id}")
async def update_host(
    host_id: str,
    payload: HostPayload,
    request: Request,
    user: dict[str, str] = Depends(require_admin),
    __: None = Depends(verify_csrf),
) -> DhcpConfig:
    manager = ConfigManager()
    config = manager.load_config()
    for idx, host in enumerate(config.hosts):
        if host.id == host_id:
            config.hosts[idx] = host = DhcpHost(id=host_id, **payload.model_dump())
            break
    else:
        raise AppError("config.host_not_found", 404)
    _save_and_audit(manager, config, request, user, f"Fixed client {host.name} updated", action="host_update",
                    **_host_params(host))
    return config


@router.delete("/hosts/{host_id}")
async def delete_host(
    host_id: str,
    request: Request,
    user: dict[str, str] = Depends(require_admin),
    __: None = Depends(verify_csrf),
) -> DhcpConfig:
    manager = ConfigManager()
    config = manager.load_config()
    removed = [h for h in config.hosts if h.id == host_id]
    config.hosts = [h for h in config.hosts if h.id != host_id]
    label = removed[0].name if removed else host_id
    _save_and_audit(manager, config, request, user, f"Fixed client {label} deleted", action="host_delete",
                    **(_host_params(removed[0]) if removed else {"target": host_id}))
    return config


class OptionsPayload(BaseModel):
    global_options: DhcpOptions = Field(default_factory=dict)


@router.put("/options")
async def update_options(
    payload: OptionsPayload,
    request: Request,
    user: dict[str, str] = Depends(require_admin),
    __: None = Depends(verify_csrf),
) -> DhcpConfig:
    manager = ConfigManager()
    config = manager.load_config()
    config.global_options = payload.global_options
    _save_and_audit(manager, config, request, user, "Global DHCP options updated", action="options_update",
                    options=",".join(sorted(payload.global_options)))
    return config


@router.get("/export")
async def export_config(_: dict[str, str] = Depends(require_admin)) -> Response:
    content = ConfigManager().export_bundle()
    return Response(
        content=content,
        media_type="application/zip",
        headers={"Content-Disposition": 'attachment; filename="dui-data.zip"'},
    )


@router.get("/dhcpd-conf")
async def get_dhcpd_conf(_: dict[str, str] = Depends(require_admin)) -> Response:
    content = ConfigManager().export_dhcpd_conf()
    return Response(content=content, media_type="text/plain")


class ImportPayload(BaseModel):
    content: str = Field(max_length=1024 * 1024)


@router.post("/import")
async def import_config(
    payload: ImportPayload,
    request: Request,
    user: dict[str, str] = Depends(require_admin),
    __: None = Depends(verify_csrf),
) -> DhcpConfig:
    manager = ConfigManager()
    try:
        config = manager.import_dhcpd_conf(payload.content)
    except (DhcpValidationError, ValueError) as exc:
        audit("server", "CONFIG", "dhcpd.conf import rejected", request=request, user=user,
              severity=Severity.WARNING, action="import_conf")
        raise to_http(exc) from exc
    audit("server", "CONFIG", "DHCP configuration imported from dhcpd.conf", request=request, user=user,
          severity=Severity.NOTICE, action="import_conf")
    return config


@router.post("/import-zip")
async def import_config_zip(
    request: Request,
    file: UploadFile = File(...),
    user: dict[str, str] = Depends(require_admin),
    __: None = Depends(verify_csrf),
) -> DhcpConfig:
    manager = ConfigManager()
    try:
        zip_bytes = await file.read(MAX_ZIP_UPLOAD_BYTES + 1)
        if len(zip_bytes) > MAX_ZIP_UPLOAD_BYTES:
            raise AppError("import.zip_too_large", 413)
        config = manager.import_bundle(zip_bytes)
    except (DhcpValidationError, ValueError, AppError) as exc:
        audit("server", "CONFIG", "Zip import rejected", request=request, user=user,
              severity=Severity.WARNING, action="import_zip")
        if isinstance(exc, AppError):
            raise
        raise to_http(exc) from exc
    audit("server", "CONFIG", "DHCP configuration imported from zip", request=request, user=user,
          severity=Severity.NOTICE, action="import_zip")
    return config
