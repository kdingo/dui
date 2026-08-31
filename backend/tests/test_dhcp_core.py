from __future__ import annotations

import io
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

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


class ConfigBundleTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.settings = Settings(data_dir=Path(self.tmp.name))
        self.manager = ConfigManager(self.settings)
        self.validate = patch("app.dhcp.manager.validate_dhcpd_conf").start()
        self.reload = patch("app.dhcp.manager.reload_dhcp_service").start()
        self.addCleanup(patch.stopall)

        self.config = DhcpConfig(
            subnets=[
                DhcpSubnet(
                    id="s1",
                    name="LAN",
                    network="192.168.50.0",
                    netmask="255.255.255.0",
                    range=DhcpRange(start="192.168.50.100", end="192.168.50.200"),
                )
            ]
        )
        self.manager.save_config(self.config, apply=False)

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def test_export_bundle_contains_conf_and_json(self) -> None:
        bundle = self.manager.export_bundle()
        with zipfile.ZipFile(io.BytesIO(bundle)) as archive:
            self.assertEqual(set(archive.namelist()), {"dhcpd.conf", "config.json"})
            json_text = archive.read("config.json").decode("utf-8")
        restored = DhcpConfig.model_validate_json(json_text)
        self.assertEqual(restored.subnets[0].name, "LAN")

    def test_import_with_json_preserves_subnet_name(self) -> None:
        conf = generate_dhcpd_conf(self.config)
        imported = self.manager.import_dhcpd_conf(conf, config_json=self.config.model_dump_json())
        self.assertEqual(imported.subnets[0].name, "LAN")
        loaded = DhcpConfig.model_validate_json(self.settings.config_json.read_text(encoding="utf-8"))
        self.assertEqual(loaded.subnets[0].name, "LAN")

    def test_import_without_json_drops_subnet_name(self) -> None:
        conf = generate_dhcpd_conf(self.config)
        imported = self.manager.import_dhcpd_conf(conf)
        self.assertIsNone(imported.subnets[0].name)

    def test_import_bundle_round_trip_preserves_name(self) -> None:
        bundle = self.manager.export_bundle()
        other = tempfile.TemporaryDirectory()
        self.addCleanup(other.cleanup)
        other_manager = ConfigManager(Settings(data_dir=Path(other.name)))
        imported = other_manager.import_bundle(bundle)
        self.assertEqual(imported.subnets[0].name, "LAN")
        self.assertTrue((Path(other.name) / "dhcpd.conf").exists())
        self.assertTrue((Path(other.name) / "config.json").exists())

    def test_import_bundle_missing_dhcpd_conf(self) -> None:
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w") as archive:
            archive.writestr("config.json", self.config.model_dump_json())
        with self.assertRaisesRegex(ValueError, "missing dhcpd.conf"):
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
