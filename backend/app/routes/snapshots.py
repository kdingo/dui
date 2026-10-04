from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Response

from ..auth.deps import get_current_user, require_admin, verify_csrf
from ..dhcp.manager import ConfigManager, DhcpValidationError

router = APIRouter(prefix="/api/snapshots", tags=["snapshots"])


@router.get("")
async def list_snapshots(_: dict[str, str] = Depends(get_current_user)) -> dict:
    snapshots = ConfigManager().list_snapshots()
    return {"snapshots": [s.model_dump() for s in snapshots]}


@router.get("/{snapshot_id}/dhcpd-conf")
async def get_snapshot_dhcpd_conf(
    snapshot_id: str,
    _: dict[str, str] = Depends(require_admin),
) -> Response:
    try:
        content = ConfigManager().read_snapshot_dhcpd_conf(snapshot_id)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return Response(content=content, media_type="text/plain")


@router.post("/{snapshot_id}/restore")
async def restore_snapshot(
    snapshot_id: str,
    _: dict[str, str] = Depends(require_admin),
    __: None = Depends(verify_csrf),
) -> dict[str, str]:
    manager = ConfigManager()
    try:
        manager.restore_snapshot(snapshot_id)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except DhcpValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=f"Snapshot contains invalid configuration: {exc}") from exc
    return {"status": "restored", "snapshot_id": snapshot_id}


@router.delete("/{snapshot_id}")
async def delete_snapshot(
    snapshot_id: str,
    _: dict[str, str] = Depends(require_admin),
    __: None = Depends(verify_csrf),
) -> dict[str, str]:
    try:
        ConfigManager().delete_snapshot(snapshot_id)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {"status": "deleted", "snapshot_id": snapshot_id}
