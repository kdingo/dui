from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from app.dhcp.conf_generator import generate_dhcpd_conf
from app.dhcp.conf_parser import parse_dhcpd_conf
from app.dhcp.leases import compute_subnet_usage, parse_leases
from app.dhcp.models import DhcpConfig, DhcpRange, DhcpSubnet
from app.dhcp.validator import validate_dhcpd_conf


SAMPLE_CONF = """
authoritative;
option domain-name-servers 192.168.1.1;
default-lease-time 86400;

subnet 192.168.1.0 netmask 255.255.255.0 {
  range 192.168.1.100 192.168.1.200;
  option routers 192.168.1.1;
}

host printer {
  hardware ethernet aa:bb:cc:dd:ee:ff;
  fixed-address 192.168.1.50;
}
"""

SAMPLE_LEASES = """
lease 192.168.1.101 {
  starts 3 2026/08/30 10:00:00;
  ends 4 2026/08/31 10:00:00;
  binding state active;
  hardware ethernet 11:22:33:44:55:66;
  client-hostname "laptop";
}
"""


class DhcpCoreTests(unittest.TestCase):
    def test_round_trip_config(self) -> None:
        parsed = parse_dhcpd_conf(SAMPLE_CONF)
        generated = generate_dhcpd_conf(parsed)
        reparsed = parse_dhcpd_conf(generated)
        self.assertEqual(len(reparsed.subnets), 1)
        self.assertEqual(reparsed.subnets[0].network, "192.168.1.0")
        self.assertEqual(len(reparsed.hosts), 1)
        self.assertEqual(reparsed.hosts[0].fixed_address, "192.168.1.50")

    def test_parse_leases_and_usage(self) -> None:
        config = parse_dhcpd_conf(SAMPLE_CONF)
        leases = parse_leases(SAMPLE_LEASES, config)
        self.assertEqual(len(leases), 1)
        self.assertEqual(leases[0].ip, "192.168.1.101")
        usage = compute_subnet_usage(config, leases)
        self.assertEqual(usage[0].used, 1)
        self.assertGreater(usage[0].total, 0)

    def test_skips_empty_global_options(self) -> None:
        config = DhcpConfig(
            global_options={
                "domain-name-servers": ["192.168.1.1"],
                "ntp-servers": [],
                "domain-name": "",
                "domain-search": None,
            }
        )
        conf = generate_dhcpd_conf(config)
        self.assertIn("option domain-name-servers 192.168.1.1;", conf)
        self.assertNotIn("option ntp-servers", conf)
        self.assertNotIn("option domain-name ", conf)
        self.assertNotIn("option domain-search", conf)

    def test_emits_ntp_and_domain_options(self) -> None:
        config = DhcpConfig(
            global_options={
                "ntp-servers": ["192.168.1.10", "192.168.1.11"],
                "domain-name": "example.lan",
                "domain-search": ["lan", "example.lan"],
            }
        )
        conf = generate_dhcpd_conf(config)
        self.assertIn("option ntp-servers 192.168.1.10, 192.168.1.11;", conf)
        self.assertIn('option domain-name "example.lan";', conf)
        self.assertIn('option domain-search "lan", "example.lan";', conf)

    def test_validate_generated_conf_when_dhcpd_available(self) -> None:
        config = DhcpConfig(
            subnets=[
                DhcpSubnet(
                    id="s1",
                    network="192.168.50.0",
                    netmask="255.255.255.0",
                    range=DhcpRange(start="192.168.50.100", end="192.168.50.200"),
                    options={"routers": ["192.168.50.1"]},
                )
            ]
        )
        conf = generate_dhcpd_conf(config)
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "dhcpd.conf"
            path.write_text(conf, encoding="utf-8")
            try:
                validate_dhcpd_conf(path)
            except FileNotFoundError:
                self.skipTest("dhcpd not installed in test environment")

    def test_subnet_name_is_json_metadata_not_in_conf(self) -> None:
        subnet = DhcpSubnet(
            id="s1",
            name="LAN",
            network="192.168.50.0",
            netmask="255.255.255.0",
            range=DhcpRange(start="192.168.50.100", end="192.168.50.200"),
        )
        restored = DhcpSubnet.model_validate_json(subnet.model_dump_json())
        self.assertEqual(restored.name, "LAN")
        self.assertIsNone(DhcpSubnet.model_validate({"id": "s2", "network": "10.0.0.0", "netmask": "255.255.255.0", "name": "  "}).name)

        conf = generate_dhcpd_conf(DhcpConfig(subnets=[subnet]))
        self.assertIn("subnet 192.168.50.0 netmask 255.255.255.0 {", conf)
        self.assertNotIn("LAN", conf)

        usage = compute_subnet_usage(DhcpConfig(subnets=[subnet]), [])
        self.assertEqual(usage[0].name, "LAN")


if __name__ == "__main__":
    unittest.main()
