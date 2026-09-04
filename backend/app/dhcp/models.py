from __future__ import annotations

from typing import Annotated, Any

from pydantic import AfterValidator, BaseModel, Field, field_validator

from .cidr import normalize_ipv4_cidr

IPv4Cidr = Annotated[str, AfterValidator(normalize_ipv4_cidr)]


class DhcpRange(BaseModel):
    start: str
    end: str


class DhcpSubnet(BaseModel):
    id: str
    network: IPv4Cidr
    name: str | None = None
    range: DhcpRange | None = None
    options: dict[str, Any] = Field(default_factory=dict)

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
    name: str
    hardware_address: str
    fixed_address: str
    options: dict[str, Any] = Field(default_factory=dict)


class DhcpConfig(BaseModel):
    global_options: dict[str, Any] = Field(default_factory=dict)
    subnets: list[DhcpSubnet] = Field(default_factory=list)
    hosts: list[DhcpHost] = Field(default_factory=list)
    option_definitions: list[str] = Field(default_factory=list)
    authoritative: bool = True
    ddns_update_style: str | None = "none"
    log_facility: str = "local7"

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
