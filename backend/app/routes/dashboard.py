from __future__ import annotations

from fastapi import APIRouter, Depends

from ..auth.deps import get_current_user
from ..config import get_settings, load_server_name
from ..dhcp.leases import compute_subnet_usage, read_leases_file
from ..dhcp.manager import ConfigManager

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])


@router.get("")
async def dashboard(_: dict[str, str] = Depends(get_current_user)) -> dict:
    settings = get_settings()
    manager = ConfigManager(settings)
    config = manager.load_config()
    leases = read_leases_file(settings.dhcpd_leases, config)
    subnets = compute_subnet_usage(config, leases)
    return {
        "server_name": load_server_name(settings),
        "subnets": [s.model_dump() for s in subnets],
    }
