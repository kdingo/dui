from __future__ import annotations

import ipaddress
import re
from typing import Annotated, Any

from pydantic import AfterValidator, BaseModel, Field, field_validator

from ..errors import coded
from .cidr import normalize_ipv4_cidr

# Every field below is written verbatim into dhcpd.conf, so each one is restricted to the
# characters its dhcpd grammar needs. Quotes, semicolons, braces and newlines would let a
# value break out of its statement (e.g. into `on commit { execute(...) }` or `include`).

_HOST_NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$")
_DNS_NAME_RE = re.compile(
    r"^(?=.{1,253}$)[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$"
)
_MAC_RE = re.compile(r"^[0-9A-Fa-f]{1,2}(:[0-9A-Fa-f]{1,2}){5}$")
_OPTION_KEY_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}(\.[A-Za-z0-9_-]{1,64})?$")
_UNSAFE_STRING_RE = re.compile(r'["\\;{}#\x00-\x1f\x7f]')
_TOP_LEVEL_STATEMENT_RES = (
    # option NAME code N = TYPE;   (TYPE may be a record such as { ip-address, text })
    re.compile(r"^option\s+[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)?\s+code\s+\d{1,5}\s*=\s*[A-Za-z0-9 ,{}.-]+;$"),
    # option space NAME;
    re.compile(r"^option\s+space\s+[A-Za-z0-9_-]+;$"),
    # simple flags such as `one-lease-per-client on;` or `ping-check true;` (never OMAPI)
    re.compile(r"^(?!omapi)[a-z][a-z0-9-]*\s+(on|off|true|false|\d+);$"),
    # allow/deny/ignore unknown-clients;
    re.compile(r"^(allow|deny|ignore)\s+[a-z-]+;$"),
)
DDNS_UPDATE_STYLES = {"none", "ad-hoc", "interim", "standard"}
LOG_FACILITIES = {"daemon", "user", "syslog", *(f"local{i}" for i in range(8))}


def _ipv4(value: str) -> str:
    try:
        return str(ipaddress.IPv4Address(value.strip()))
    except (ipaddress.AddressValueError, ValueError) as exc:
        raise coded("validation.ipv4", value=value) from exc


def _host_name(value: str) -> str:
    if not _HOST_NAME_RE.match(value):
        raise coded("validation.host_name")
    return value


def _mac(value: str) -> str:
    value = value.strip()
    if not _MAC_RE.match(value):
        raise coded("validation.mac", value=value)
    return value.lower()


def _fixed_address(value: str) -> str:
    value = value.strip()
    try:
        return _ipv4(value)
    except ValueError:
        if _DNS_NAME_RE.match(value):
            return value
        raise coded("validation.fixed_address", value=value) from None


def _safe_string(value: str) -> str:
    if _UNSAFE_STRING_RE.search(value):
        raise coded("validation.unsafe_string", value=value)
    return value


def _option_scalar(value: Any) -> Any:
    if value is None or isinstance(value, (bool, int, float)):
        return value
    if isinstance(value, str):
        return _safe_string(value)
    raise coded("validation.option_value")


def _options(value: dict[str, Any]) -> dict[str, Any]:
    cleaned: dict[str, Any] = {}
    for key, item in value.items():
        if not _OPTION_KEY_RE.match(key):
            raise coded("validation.option_name", name=key)
        cleaned[key] = [_option_scalar(v) for v in item] if isinstance(item, list) else _option_scalar(item)
    return cleaned


def _top_level_statement(value: str) -> str:
    value = value.strip()
    if not any(pattern.match(value) for pattern in _TOP_LEVEL_STATEMENT_RES):
        raise coded("validation.statement", value=value)
    return value


def _ddns_update_style(value: str | None) -> str | None:
    if value is not None and value not in DDNS_UPDATE_STYLES:
        raise coded("validation.ddns_update_style", choices=", ".join(sorted(DDNS_UPDATE_STYLES)))
    return value


def _log_facility(value: str) -> str:
    if value not in LOG_FACILITIES:
        raise coded("validation.log_facility", choices=", ".join(sorted(LOG_FACILITIES)))
    return value


IPv4Cidr = Annotated[str, AfterValidator(normalize_ipv4_cidr)]
IPv4Addr = Annotated[str, AfterValidator(_ipv4)]
HostName = Annotated[str, AfterValidator(_host_name)]
MacAddress = Annotated[str, AfterValidator(_mac)]
FixedAddress = Annotated[str, AfterValidator(_fixed_address)]
DhcpOptions = Annotated[dict[str, Any], AfterValidator(_options)]
TopLevelStatement = Annotated[str, AfterValidator(_top_level_statement)]


class DhcpRange(BaseModel):
    start: IPv4Addr
    end: IPv4Addr


class DhcpSubnet(BaseModel):
    id: str
    network: IPv4Cidr
    name: str | None = Field(default=None, max_length=128)
    range: DhcpRange | None = None
    options: DhcpOptions = Field(default_factory=dict)

    @field_validator("name", mode="before")
    @classmethod
    def empty_name_to_none(cls, value: object) -> str | None:
        if value is None:
            return None
        if isinstance(value, str) and not value.strip():
            return None
        return str(value)


class DhcpHost(BaseModel):
    id: str
    name: HostName
    hardware_address: MacAddress
    fixed_address: FixedAddress
    options: DhcpOptions = Field(default_factory=dict)


class DhcpConfig(BaseModel):
    global_options: DhcpOptions = Field(default_factory=dict)
    subnets: list[DhcpSubnet] = Field(default_factory=list)
    hosts: list[DhcpHost] = Field(default_factory=list)
    option_definitions: list[TopLevelStatement] = Field(default_factory=list)
    authoritative: bool = True
    ddns_update_style: Annotated[str | None, AfterValidator(_ddns_update_style)] = "none"
    log_facility: Annotated[str, AfterValidator(_log_facility)] = "local7"

    @classmethod
    def default_sample(cls) -> "DhcpConfig":
        return cls(
            global_options={
                "default-lease-time": 86400,
                "max-lease-time": 604800,
                "domain-name-servers": ["192.168.1.1"],
            },
            subnets=[
                DhcpSubnet(
                    id="subnet-1",
                    network="192.168.1.0/24",
                    range=DhcpRange(start="192.168.1.100", end="192.168.1.200"),
                    options={"routers": ["192.168.1.1"]},
                )
            ],
            hosts=[],
        )


class Lease(BaseModel):
    ip: str
    mac: str | None = None
    hostname: str | None = None
    starts: str | None = None
    ends: str | None = None
    binding_state: str | None = None
    subnet_id: str | None = None
    subnet_network: str | None = None


class SubnetUsage(BaseModel):
    id: str
    network: str
    name: str | None = None
    range_start: str | None = None
    range_end: str | None = None
    total: int
    used: int
    free: int
    utilization_pct: float


class SnapshotInfo(BaseModel):
    id: str
    created_at: str
    has_config_json: bool
    has_dhcpd_conf: bool
