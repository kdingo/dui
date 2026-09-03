from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, File, HTTPException, Response, UploadFile
from pydantic import BaseModel, Field

from ..auth.deps import get_current_user, require_admin, verify_csrf
from ..dhcp.manager import ConfigManager, DhcpValidationError
from ..dhcp.models import DhcpConfig, DhcpHost, DhcpRange, DhcpSubnet

router = APIRouter(prefix="/api/config", tags=["config"])


@router.get("")
async def get_config(_: dict[str, str] = Depends(get_current_user)) -> DhcpConfig:
    return ConfigManager().load_config()


@router.put("")
async def replace_config(
    config: DhcpConfig,
    _: dict[str, str] = Depends(require_admin),
    __: None = Depends(verify_csrf),
) -> DhcpConfig:
    manager = ConfigManager()
    try:
        manager.save_config(config, apply=True)
    except DhcpValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return manager.load_config()


@router.post("/apply")
async def apply_config(
    _: dict[str, str] = Depends(require_admin),
    __: None = Depends(verify_csrf),
) -> dict[str, str]:
    manager = ConfigManager()
    try:
        manager.apply_config()
    except DhcpValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"status": "applied"}


class SubnetPayload(BaseModel):
    network: str
    netmask: str
    name: str | None = None
    range: DhcpRange | None = None
    options: dict = Field(default_factory=dict)


@router.post("/subnets")
async def add_subnet(
    payload: SubnetPayload,
    _: dict[str, str] = Depends(require_admin),
    __: None = Depends(verify_csrf),
) -> DhcpConfig:
    manager = ConfigManager()
    config = manager.load_config()
    config.subnets.append(
        DhcpSubnet(id=f"subnet-{uuid.uuid4().hex[:8]}", **payload.model_dump())
    )
    try:
        manager.save_config(config, apply=True)
    except DhcpValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return config


@router.put("/subnets/{subnet_id}")
async def update_subnet(
    subnet_id: str,
    payload: SubnetPayload,
    _: dict[str, str] = Depends(require_admin),
    __: None = Depends(verify_csrf),
) -> DhcpConfig:
    manager = ConfigManager()
    config = manager.load_config()
    for idx, subnet in enumerate(config.subnets):
        if subnet.id == subnet_id:
            config.subnets[idx] = DhcpSubnet(id=subnet_id, **payload.model_dump())
            break
    else:
        raise HTTPException(status_code=404, detail="Subnet not found")
    try:
        manager.save_config(config, apply=True)
    except DhcpValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return config


@router.delete("/subnets/{subnet_id}")
async def delete_subnet(
    subnet_id: str,
    _: dict[str, str] = Depends(require_admin),
    __: None = Depends(verify_csrf),
) -> DhcpConfig:
    manager = ConfigManager()
    config = manager.load_config()
    config.subnets = [s for s in config.subnets if s.id != subnet_id]
    try:
        manager.save_config(config, apply=True)
    except DhcpValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return config


class HostPayload(BaseModel):
    name: str
    hardware_address: str
    fixed_address: str
    options: dict = Field(default_factory=dict)


@router.post("/hosts")
async def add_host(
    payload: HostPayload,
    _: dict[str, str] = Depends(require_admin),
    __: None = Depends(verify_csrf),
) -> DhcpConfig:
    manager = ConfigManager()
    config = manager.load_config()
    config.hosts.append(DhcpHost(id=f"host-{uuid.uuid4().hex[:8]}", **payload.model_dump()))
    try:
        manager.save_config(config, apply=True)
    except DhcpValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return config


@router.put("/hosts/{host_id}")
async def update_host(
    host_id: str,
    payload: HostPayload,
    _: dict[str, str] = Depends(require_admin),
    __: None = Depends(verify_csrf),
) -> DhcpConfig:
    manager = ConfigManager()
    config = manager.load_config()
    for idx, host in enumerate(config.hosts):
        if host.id == host_id:
            config.hosts[idx] = DhcpHost(id=host_id, **payload.model_dump())
            break
    else:
        raise HTTPException(status_code=404, detail="Host not found")
    try:
        manager.save_config(config, apply=True)
    except DhcpValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return config


@router.delete("/hosts/{host_id}")
async def delete_host(
    host_id: str,
    _: dict[str, str] = Depends(require_admin),
    __: None = Depends(verify_csrf),
) -> DhcpConfig:
    manager = ConfigManager()
    config = manager.load_config()
    config.hosts = [h for h in config.hosts if h.id != host_id]
    try:
        manager.save_config(config, apply=True)
    except DhcpValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return config


class OptionsPayload(BaseModel):
    global_options: dict = Field(default_factory=dict)


@router.put("/options")
async def update_options(
    payload: OptionsPayload,
    _: dict[str, str] = Depends(require_admin),
    __: None = Depends(verify_csrf),
) -> DhcpConfig:
    manager = ConfigManager()
    config = manager.load_config()
    config.global_options = payload.global_options
    try:
        manager.save_config(config, apply=True)
    except DhcpValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
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
    content: str


@router.post("/import")
async def import_config(
    payload: ImportPayload,
    _: dict[str, str] = Depends(require_admin),
    __: None = Depends(verify_csrf),
) -> DhcpConfig:
    manager = ConfigManager()
    try:
        return manager.import_dhcpd_conf(payload.content)
    except DhcpValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/import-zip")
async def import_config_zip(
    file: UploadFile = File(...),
    _: dict[str, str] = Depends(require_admin),
    __: None = Depends(verify_csrf),
) -> DhcpConfig:
    manager = ConfigManager()
    try:
        zip_bytes = await file.read()
        return manager.import_bundle(zip_bytes)
    except DhcpValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
