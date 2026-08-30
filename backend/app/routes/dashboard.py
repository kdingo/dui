from __future__ import annotations

from fastapi import APIRouter, Depends

from ..auth.deps import get_current_user
from ..config import get_settings
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
    server_name = settings.server_name
    if settings.server_yaml.exists():
        import yaml

        data = yaml.safe_load(settings.server_yaml.read_text(encoding="utf-8")) or {}
        server_name = data.get("name", server_name)
    return {
        "server_name": server_name,
        "subnets": [s.model_dump() for s in subnets],
    }
