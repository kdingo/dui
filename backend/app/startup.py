"""Container start-up: bring /data into a consistent, validated state before services start.

dhcpd.conf is always regenerated from validated data, so a dhcpd.conf written by an older
release's raw import (which could contain `include` or `on commit { execute(...) }`) doesn't
survive an upgrade. Items that fail validation are dropped one by one and logged, keeping the
rest of a working configuration. If nothing valid can be recovered, the unsafe dhcpd.conf is
moved aside and replaced with one that serves no subnets (fail closed).
"""

from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from typing import Any

from pydantic import TypeAdapter, ValidationError

from .config import get_settings
from .dhcp.conf_parser import parse_dhcpd_conf
from .dhcp.manager import ConfigManager
from .dhcp.models import DhcpConfig, DhcpHost, DhcpOptions, DhcpSubnet, TopLevelStatement

_OPTIONS = TypeAdapter(DhcpOptions)
_STATEMENT = TypeAdapter(TopLevelStatement)


def _warn(message: str) -> None:
    print(f"DUI WARNING: {message}", file=sys.stderr, flush=True)


def _valid(adapter: TypeAdapter, value: Any) -> bool:
    try:
        adapter.validate_python(value)
        return True
    except ValidationError:
        return False


def _clean_options(options: Any, where: str, dropped: list[str]) -> dict[str, Any]:
    if not isinstance(options, dict):
        dropped.append(f"{where} options")
        return {}
    kept = {}
    for key, value in options.items():
        if _valid(_OPTIONS, {key: value}):
            kept[key] = value
        else:
            dropped.append(f"{where} option {key!r}")
    return kept


def salvage_config(raw: dict[str, Any]) -> tuple[DhcpConfig, list[str]]:
    """Validate ``raw``, dropping (and reporting) only the parts that fail."""
    dropped: list[str] = []
    raw = dict(raw)
    statements = raw.get("option_definitions") or []
    raw["option_definitions"] = [s for s in statements if _valid(_STATEMENT, s)]
    dropped += [f"statement {s!r}" for s in statements if not _valid(_STATEMENT, s)]
    raw["global_options"] = _clean_options(raw.get("global_options") or {}, "global", dropped)

    subnets = []
    for subnet in raw.get("subnets") or []:
        subnet = dict(subnet, options=_clean_options(subnet.get("options") or {}, f"subnet {subnet.get('network')}", dropped))
        try:
            subnets.append(DhcpSubnet.model_validate(subnet).model_dump())
        except ValidationError:
            dropped.append(f"subnet {subnet.get('network')!r}")
    raw["subnets"] = subnets

    hosts = []
    for host in raw.get("hosts") or []:
        host = dict(host, options=_clean_options(host.get("options") or {}, f"host {host.get('name')}", dropped))
        try:
            hosts.append(DhcpHost.model_validate(host).model_dump())
        except ValidationError:
            dropped.append(f"host {host.get('name')!r}")
    raw["hosts"] = hosts

    defaults = DhcpConfig()
    for field in ("ddns_update_style", "log_facility"):
        try:
            DhcpConfig.model_validate({field: raw.get(field, getattr(defaults, field))})
        except ValidationError:
            dropped.append(f"{field} {raw.get(field)!r}")
            raw[field] = getattr(defaults, field)
    return DhcpConfig.model_validate(raw), dropped


def main() -> int:
    settings = get_settings()
    manager = ConfigManager(settings)
    try:
        if settings.config_json.exists():
            config, dropped = salvage_config(json.loads(settings.config_json.read_text(encoding="utf-8")))
        elif settings.dhcpd_conf.exists():
            config, dropped = parse_dhcpd_conf(settings.dhcpd_conf.read_text(encoding="utf-8")), []
        else:
            config, dropped = DhcpConfig.default_sample(), []
    except (ValidationError, ValueError) as exc:
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        if settings.dhcpd_conf.exists():
            aside = settings.dhcpd_conf.with_name(f"dhcpd.conf.rejected-{stamp}")
            settings.dhcpd_conf.rename(aside)
            _warn(f"dhcpd.conf could not be validated and was moved to {aside.name}: {exc}")
        _warn("starting with an empty DHCP configuration; restore one from the UI (Snapshots or Import)")
        config, dropped = DhcpConfig(), []
    for item in dropped:
        _warn(f"removed invalid or unsafe {item} from the DHCP configuration")
    manager.save_config(config, apply=False)
    return 0


if __name__ == "__main__":
    sys.exit(main())
