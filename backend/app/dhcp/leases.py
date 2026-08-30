from __future__ import annotations

import ipaddress
import re
from datetime import datetime
from pathlib import Path

from .models import DhcpConfig, DhcpSubnet, Lease, SubnetUsage


def _parse_lease_time(value: str | None) -> datetime | None:
    if not value:
        return None
    for fmt in ("%Y/%m/%d %H:%M:%S", "%Y-%m-%d %H:%M:%S"):
        try:
            return datetime.strptime(value, fmt)
        except ValueError:
            continue
    return None


def parse_leases(content: str, config: DhcpConfig | None = None) -> list[Lease]:
    leases: list[Lease] = []
    blocks = re.split(r"\n(?=lease\s+)", content.strip())
    for block in blocks:
        if not block.strip():
            continue
        header = re.match(r"lease\s+(\S+)\s+\{", block)
        if not header:
            continue
        ip = header.group(1)
        mac_match = re.search(r"hardware ethernet\s+(\S+);", block)
        hostname_match = re.search(r'client-hostname\s+"([^"]+)";', block)
        starts_match = re.search(r"starts\s+\d+\s+(.+?);", block)
        ends_match = re.search(r"ends\s+\d+\s+(.+?);", block)
        state_match = re.search(r"binding state\s+(\S+);", block)

        lease = Lease(
            ip=ip,
            mac=mac_match.group(1) if mac_match else None,
            hostname=hostname_match.group(1) if hostname_match else None,
            starts=starts_match.group(1) if starts_match else None,
            ends=ends_match.group(1) if ends_match else None,
            binding_state=state_match.group(1) if state_match else None,
        )
        if config:
            lease.subnet_id, lease.subnet_network = _match_subnet(ip, config)
        leases.append(lease)
    return leases


def _match_subnet(ip: str, config: DhcpConfig) -> tuple[str | None, str | None]:
    try:
        addr = ipaddress.ip_address(ip)
    except ValueError:
        return None, None
    for subnet in config.subnets:
        network = ipaddress.ip_network(f"{subnet.network}/{subnet.netmask}", strict=False)
        if addr in network:
            return subnet.id, subnet.network
    return None, None


def _ip_to_int(ip: str) -> int:
    return int(ipaddress.ip_address(ip))


def _range_size(start: str, end: str) -> int:
    return _ip_to_int(end) - _ip_to_int(start) + 1


def compute_subnet_usage(config: DhcpConfig, leases: list[Lease]) -> list[SubnetUsage]:
    results: list[SubnetUsage] = []
    now = datetime.now()
    for subnet in config.subnets:
        if not subnet.range:
            results.append(
                SubnetUsage(
                    id=subnet.id,
                    network=subnet.network,
                    netmask=subnet.netmask,
                    name=subnet.name,
                    total=0,
                    used=0,
                    free=0,
                    utilization_pct=0.0,
                )
            )
            continue
        total = _range_size(subnet.range.start, subnet.range.end)
        active = 0
        for lease in leases:
            if lease.subnet_id != subnet.id:
                continue
            if lease.binding_state not in {None, "active"}:
                continue
            ends = _parse_lease_time(lease.ends)
            if ends and ends < now:
                continue
            if lease.ip and subnet.range:
                ip_int = _ip_to_int(lease.ip)
                if _ip_to_int(subnet.range.start) <= ip_int <= _ip_to_int(subnet.range.end):
                    active += 1
        free = max(total - active, 0)
        utilization = (active / total * 100) if total else 0.0
        results.append(
            SubnetUsage(
                id=subnet.id,
                network=subnet.network,
                netmask=subnet.netmask,
                name=subnet.name,
                range_start=subnet.range.start,
                range_end=subnet.range.end,
                total=total,
                used=active,
                free=free,
                utilization_pct=round(utilization, 1),
            )
        )
    return results


def read_leases_file(path: Path, config: DhcpConfig | None = None) -> list[Lease]:
    if not path.exists():
        return []
    return parse_leases(path.read_text(encoding="utf-8", errors="replace"), config)
