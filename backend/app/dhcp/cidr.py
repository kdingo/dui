from __future__ import annotations

import ipaddress

from ..errors import coded


def normalize_ipv4_cidr(value: str) -> str:
    if not isinstance(value, str) or "/" not in value:
        raise coded("validation.cidr")
    try:
        network = ipaddress.IPv4Network(value, strict=False)
    except (ipaddress.AddressValueError, ipaddress.NetmaskValueError, ValueError) as exc:
        raise coded("validation.cidr") from exc
    return str(network)


def to_cidr(addr: str, netmask: str) -> str:
    return str(ipaddress.IPv4Network(f"{addr}/{netmask}", strict=False))


def cidr_to_dhcpd(cidr: str) -> tuple[str, str]:
    network = ipaddress.IPv4Network(cidr, strict=False)
    return str(network.network_address), str(network.netmask)
