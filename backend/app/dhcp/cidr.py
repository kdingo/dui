from __future__ import annotations

import ipaddress


def normalize_ipv4_cidr(value: str) -> str:
    if not isinstance(value, str) or "/" not in value:
        raise ValueError("network must be an IPv4 CIDR (e.g. 192.168.1.0/24)")
    try:
        network = ipaddress.IPv4Network(value, strict=False)
    except (ipaddress.AddressValueError, ipaddress.NetmaskValueError, ValueError) as exc:
        raise ValueError("network must be an IPv4 CIDR (e.g. 192.168.1.0/24)") from exc
    return str(network)


def to_cidr(addr: str, netmask: str) -> str:
    return str(ipaddress.IPv4Network(f"{addr}/{netmask}", strict=False))


def cidr_to_dhcpd(cidr: str) -> tuple[str, str]:
    network = ipaddress.IPv4Network(cidr, strict=False)
    return str(network.network_address), str(network.netmask)
