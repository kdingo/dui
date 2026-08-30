from __future__ import annotations

from fastapi import APIRouter, Depends, Query

from ..auth.deps import get_current_user
from ..config import get_settings
from ..dhcp.leases import read_leases_file
from ..dhcp.manager import ConfigManager

router = APIRouter(prefix="/api/leases", tags=["leases"])


@router.get("")
async def list_leases(
    subnet: str | None = Query(default=None),
    _: dict[str, str] = Depends(get_current_user),
) -> dict:
    settings = get_settings()
    config = ConfigManager(settings).load_config()
    leases = read_leases_file(settings.dhcpd_leases, config)
    if subnet:
        leases = [l for l in leases if l.subnet_id == subnet or l.subnet_network == subnet]
    return {"leases": [l.model_dump() for l in leases]}
