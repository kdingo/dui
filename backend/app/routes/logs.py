from __future__ import annotations

from collections import deque
from pathlib import Path

from fastapi import APIRouter, Depends, Query

from ..auth.deps import get_current_user
from ..config import get_settings

router = APIRouter(prefix="/api/logs", tags=["logs"])


def _tail_file(path, tail: int) -> list[str]:
    syslog_path = path.parent / "syslog.log"
    candidates = [path, syslog_path, path.with_name("syslog")]
    for candidate in candidates:
        if candidate.exists():
            with candidate.open(encoding="utf-8", errors="replace") as handle:
                return [line.rstrip("\r\n") for line in deque(handle, maxlen=tail)]
    return []


@router.get("/dhcp")
async def dhcp_logs(
    tail: int = Query(default=500, ge=1, le=5000),
    _: dict[str, str] = Depends(get_current_user),
) -> dict:
    settings = get_settings()
    lines = _tail_file(settings.dhcpd_log, tail)
    if not lines:
        # Debian default when file logging is unavailable
        fallback = Path("/var/log/syslog")
        if fallback.exists():
            with fallback.open(encoding="utf-8", errors="replace") as handle:
                lines = [
                    line.rstrip("\r\n")
                    for line in deque(handle, maxlen=tail)
                    if "dhcpd" in line.lower()
                ]
    return {"lines": lines, "path": str(settings.dhcpd_log)}
