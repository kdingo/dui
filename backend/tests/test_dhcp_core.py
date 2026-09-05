from __future__ import annotations

import io
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

from pydantic import ValidationError

from app.config import Settings
from app.dhcp.conf_generator import generate_dhcpd_conf
from app.dhcp.conf_parser import parse_dhcpd_conf
from app.dhcp.leases import compute_subnet_usage, parse_leases
from app.dhcp.manager import ConfigManager, s6_svstat_is_running
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
  ends 4 2099/08/31 10:00:00;
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
        self.assertEqual(reparsed.subnets[0].network, "192.168.1.0/24")
        self.assertEqual(len(reparsed.hosts), 1)
        self.assertEqual(reparsed.hosts[0].fixed_address, "192.168.1.50")

    def test_parse_leases_and_usage(self) -> None:
        config = parse_dhcpd_conf(SAMPLE_CONF)
        leases = parse_leases(SAMPLE_LEASES, config)
        self.assertEqual(len(leases), 1)
        self.assertEqual(leases[0].ip, "192.168.1.101")
        self.assertEqual(leases[0].subnet_network, "192.168.1.0/24")
        usage = compute_subnet_usage(config, leases)
        self.assertEqual(usage[0].used, 1)
        self.assertGreater(usage[0].total, 0)

    def test_parse_leases_keeps_last_block_per_ip(self) -> None:
        config = parse_dhcpd_conf(SAMPLE_CONF)
        duplicate_leases = """
lease 192.168.1.101 {
  starts 3 2026/08/30 09:00:00;
  ends 3 2026/08/30 10:00:00;
  binding state free;
  hardware ethernet 11:22:33:44:55:66;
  client-hostname "laptop";
}
lease 192.168.1.101 {
  starts 3 2026/08/30 10:00:00;
  ends 4 2099/08/31 10:00:00;
  binding state active;
  hardware ethernet 11:22:33:44:55:66;
  client-hostname "laptop";
}
lease 192.168.1.102 {
  starts 3 2026/08/30 11:00:00;
  ends 4 2099/08/31 11:00:00;
  binding state active;
  hardware ethernet aa:bb:cc:dd:ee:ff;
}
"""
        leases = parse_leases(duplicate_leases, config)
        self.assertEqual(len(leases), 2)
        by_ip = {lease.ip: lease for lease in leases}
        self.assertEqual(by_ip["192.168.1.101"].binding_state, "active")
        self.assertEqual(by_ip["192.168.1.101"].starts, "2026/08/30 10:00:00")
        self.assertEqual(by_ip["192.168.1.101"].ends, "2099/08/31 10:00:00")
        self.assertEqual(by_ip["192.168.1.102"].mac, "aa:bb:cc:dd:ee:ff")

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
                    network="192.168.50.0/24",
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
            network="192.168.50.0/24",
            range=DhcpRange(start="192.168.50.100", end="192.168.50.200"),
        )
        restored = DhcpSubnet.model_validate_json(subnet.model_dump_json())
        self.assertEqual(restored.name, "LAN")
        self.assertIsNone(DhcpSubnet.model_validate({"id": "s2", "network": "10.0.0.0/24", "name": "  "}).name)

        conf = generate_dhcpd_conf(DhcpConfig(subnets=[subnet]))
        self.assertIn("subnet 192.168.50.0 netmask 255.255.255.0 {", conf)
        self.assertNotIn("LAN", conf)

        usage = compute_subnet_usage(DhcpConfig(subnets=[subnet]), [])
        self.assertEqual(usage[0].name, "LAN")

    def test_subnet_network_normalizes_host_bits(self) -> None:
        subnet = DhcpSubnet.model_validate({"id": "s1", "network": "192.168.1.50/24"})
        self.assertEqual(subnet.network, "192.168.1.0/24")

    def test_subnet_network_rejects_invalid_cidr(self) -> None:
        with self.assertRaises(ValidationError):
            DhcpSubnet.model_validate({"id": "s1", "network": "192.168.1.0"})
        with self.assertRaises(ValidationError):
            DhcpSubnet.model_validate({"id": "s1", "network": "not-a-network/24"})
        with self.assertRaises(ValidationError):
            DhcpSubnet.model_validate({"id": "s1", "network": "2001:db8::/64"})


class ConfigBundleTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        root = Path(self.tmp.name)
        data_dir = root / "data"
        data_dir.mkdir()
        self.settings = Settings(
            data_dir=data_dir,
            logs_dir=root / "logs",
        )
        self.manager = ConfigManager(self.settings)
        self.validate = patch("app.dhcp.manager.validate_dhcpd_conf").start()
        self.reload = patch("app.dhcp.manager.reload_dhcp_service").start()
        self.addCleanup(patch.stopall)

        self.config = DhcpConfig(
            subnets=[
                DhcpSubnet(
                    id="s1",
                    name="LAN",
                    network="192.168.50.0/24",
                    range=DhcpRange(start="192.168.50.100", end="192.168.50.200"),
                )
            ]
        )
        self.manager.save_config(self.config, apply=False)

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def test_export_bundle_contains_data_dir_files(self) -> None:
        leases = self.settings.dhcpd_leases
        leases.write_text(SAMPLE_LEASES, encoding="utf-8")
        (self.settings.data_dir / "users.yaml").write_text("users: []\n", encoding="utf-8")
        bundle = self.manager.export_bundle()
        with zipfile.ZipFile(io.BytesIO(bundle)) as archive:
            names = set(archive.namelist())
        self.assertIn("dhcpd.conf", names)
        self.assertIn("config.json", names)
        self.assertIn("dhcpd.leases", names)
        self.assertIn("users.yaml", names)

    def test_import_without_json_drops_subnet_name(self) -> None:
        conf = generate_dhcpd_conf(self.config)
        imported = self.manager.import_dhcpd_conf(conf)
        self.assertIsNone(imported.subnets[0].name)

    def test_import_bundle_round_trip_restores_extra_files(self) -> None:
        (self.settings.data_dir / "users.yaml").write_text("users: []\n", encoding="utf-8")
        self.settings.dhcpd_leases.write_text(SAMPLE_LEASES, encoding="utf-8")
        bundle = self.manager.export_bundle()
        other = tempfile.TemporaryDirectory()
        self.addCleanup(other.cleanup)
        other_root = Path(other.name) / "data"
        other_root.mkdir()
        (other_root / "stale.txt").write_text("remove me", encoding="utf-8")
        other_manager = ConfigManager(
            Settings(
                data_dir=other_root,
                logs_dir=Path(other.name) / "logs",
            )
        )
        imported = other_manager.import_bundle(bundle)
        self.assertEqual(imported.subnets[0].name, "LAN")
        self.assertTrue((other_root / "dhcpd.conf").exists())
        self.assertTrue((other_root / "config.json").exists())
        self.assertEqual((other_root / "users.yaml").read_text(encoding="utf-8"), "users: []\n")
        self.assertEqual((other_root / "dhcpd.leases").read_text(encoding="utf-8"), SAMPLE_LEASES)
        self.assertFalse((other_root / "stale.txt").exists())

    def test_import_bundle_missing_dhcpd_conf(self) -> None:
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w") as archive:
            archive.writestr("config.json", self.config.model_dump_json())
        with self.assertRaisesRegex(ValueError, "missing dhcpd.conf"):
            self.manager.import_bundle(buffer.getvalue())

    def test_import_bundle_rejects_zip_slip(self) -> None:
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w") as archive:
            archive.writestr("../outside.txt", "nope")
            archive.writestr("dhcpd.conf", generate_dhcpd_conf(self.config))
        with self.assertRaisesRegex(ValueError, "Unsafe zip member path"):
            self.manager.import_bundle(buffer.getvalue())


class S6SvstatTests(unittest.TestCase):
    def test_up_at_start_of_line_is_running(self) -> None:
        self.assertTrue(s6_svstat_is_running("up (pid 53 pgid 53) 23825 seconds"))

    def test_down_normally_up_is_stopped(self) -> None:
        self.assertFalse(s6_svstat_is_running("down 5 seconds, normally up"))

    def test_empty_is_stopped(self) -> None:
        self.assertFalse(s6_svstat_is_running(""))


if __name__ == "__main__":
    unittest.main()
