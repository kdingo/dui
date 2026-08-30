from __future__ import annotations

import re
import uuid
from typing import Any

from .models import DhcpConfig, DhcpHost, DhcpRange, DhcpSubnet


def _parse_option_value(raw: str) -> Any:
    raw = raw.strip().rstrip(";")
    if raw.startswith('"') and raw.endswith('"'):
        return raw[1:-1]
    if raw in {"true", "false"}:
        return raw == "true"
    if re.match(r"^-?\d+$", raw):
        return int(raw)
    parts = [p.strip().strip('"') for p in raw.split(",")]
    if len(parts) > 1:
        return parts
    return raw


def _collect_options(lines: list[str]) -> dict[str, Any]:
    options: dict[str, Any] = {}
    for line in lines:
        match = re.match(r"option\s+([\w-]+)\s+(.+);", line.strip())
        if match:
            options[match.group(1)] = _parse_option_value(match.group(2))
    return options


def parse_dhcpd_conf(content: str) -> DhcpConfig:
    lines = [line.strip() for line in content.splitlines() if line.strip() and not line.strip().startswith("#")]

    global_options: dict[str, Any] = {}
    option_definitions: list[str] = []
    subnets: list[DhcpSubnet] = []
    hosts: list[DhcpHost] = []
    authoritative = False
    ddns_update_style: str | None = None
    log_facility = "local7"

    i = 0
    while i < len(lines):
        line = lines[i]
        if line.startswith("option "):
            match = re.match(r"option\s+([\w-]+)\s+(.+);", line)
            if match:
                global_options[match.group(1)] = _parse_option_value(match.group(2))
            i += 1
            continue
        if line.startswith("default-lease-time ") or line.startswith("max-lease-time ") or line.startswith("min-lease-time "):
            parts = line.rstrip(";").split(None, 1)
            if len(parts) == 2:
                key = parts[0]
                global_options[key] = _parse_option_value(parts[1])
            i += 1
            continue
        if line.startswith("log-facility "):
            log_facility = line.split()[1].rstrip(";")
            i += 1
            continue
        if line.startswith("ddns-update-style "):
            ddns_update_style = line.split()[1].rstrip(";")
            i += 1
            continue
        if line == "authoritative;":
            authoritative = True
            i += 1
            continue
        if line.startswith("subnet "):
            header = re.match(r"subnet\s+(\S+)\s+netmask\s+(\S+)\s+\{", line)
            if not header:
                i += 1
                continue
            block_lines: list[str] = []
            i += 1
            while i < len(lines) and lines[i] != "}":
                block_lines.append(lines[i])
                i += 1
            range_match = None
            subnet_options: dict[str, Any] = {}
            for bl in block_lines:
                rm = re.match(r"range\s+(\S+)\s+(\S+);", bl)
                if rm:
                    range_match = DhcpRange(start=rm.group(1), end=rm.group(2))
                elif bl.startswith("option "):
                    om = re.match(r"option\s+([\w-]+)\s+(.+);", bl)
                    if om:
                        subnet_options[om.group(1)] = _parse_option_value(om.group(2))
            subnets.append(
                DhcpSubnet(
                    id=f"subnet-{uuid.uuid4().hex[:8]}",
                    network=header.group(1),
                    netmask=header.group(2),
                    range=range_match,
                    options=subnet_options,
                )
            )
            i += 1
            continue
        if line.startswith("host "):
            header = re.match(r"host\s+(\S+)\s+\{", line)
            if not header:
                i += 1
                continue
            block_lines = []
            i += 1
            while i < len(lines) and lines[i] != "}":
                block_lines.append(lines[i])
                i += 1
            mac = None
            fixed = None
            host_options: dict[str, Any] = {}
            for bl in block_lines:
                mm = re.match(r"hardware ethernet\s+(\S+);", bl)
                if mm:
                    mac = mm.group(1)
                fm = re.match(r"fixed-address\s+(\S+);", bl)
                if fm:
                    fixed = fm.group(1)
                elif bl.startswith("option "):
                    om = re.match(r"option\s+([\w-]+)\s+(.+);", bl)
                    if om:
                        host_options[om.group(1)] = _parse_option_value(om.group(2))
            if mac and fixed:
                hosts.append(
                    DhcpHost(
                        id=f"host-{uuid.uuid4().hex[:8]}",
                        name=header.group(1),
                        hardware_address=mac,
                        fixed_address=fixed,
                        options=host_options,
                    )
                )
            i += 1
            continue
        if not line.endswith("{") and not line.endswith("}"):
            option_definitions.append(line.rstrip(";") + ";")
        i += 1

    return DhcpConfig(
        global_options=global_options,
        subnets=subnets,
        hosts=hosts,
        option_definitions=option_definitions,
        authoritative=authoritative,
        ddns_update_style=ddns_update_style,
        log_facility=log_facility,
    )
