from __future__ import annotations

import os
import socket
import tempfile
import threading
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

import yaml
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.auth.users import hash_password
from app.config import get_settings
from app.dhcp.lease_events import LeaseLogWatcher, parse_dhcpd_line
from app.main import app
from app.routes import auth as auth_routes
from app.syslog import (
    Severity,
    SyslogConfig,
    SyslogEmitter,
    emitter,
    format_rfc5424,
    load_syslog_config,
    message_hostname,
    save_syslog_config,
)

ADMIN_PW = "correct-horse-battery"
VIEWER_PW = "viewer-password-123"
FIXED_NOW = datetime(2026, 10, 8, 12, 34, 56, 789000, tzinfo=timezone.utc)


class FormatTests(unittest.TestCase):
    def test_header_and_priority(self) -> None:
        config = SyslogConfig(enabled=True, host="127.0.0.1")
        line = format_rfc5424(
            config, Severity.WARNING, "AUTH", "Failed login", {"user": "bob"}, hostname="dhcp-box", now=FIXED_NOW
        )
        pid = os.getpid()
        # daemon = 3; 3 * 8 + 4 = 28
        self.assertEqual(
            line.decode(),
            f'<28>1 2026-10-08T12:34:56.789Z dhcp-box dui {pid} AUTH [dui@32473 user="bob"] Failed login',
        )

    def test_sd_escaping_and_control_chars(self) -> None:
        line = format_rfc5424(
            SyslogConfig(),
            Severity.INFO,
            "X",
            "line1\nline2",
            {"v": 'a"b\\c]d', "empty": "", "none": None},
            hostname="h",
            now=FIXED_NOW,
        ).decode()
        self.assertIn(r'[dui@32473 v="a\"b\\c\]d"]', line)
        self.assertNotIn("empty=", line)
        self.assertNotIn("none=", line)
        self.assertTrue(line.endswith("line1 line2"))

    def test_no_structured_data(self) -> None:
        line = format_rfc5424(SyslogConfig(), Severity.INFO, "TEST", "hi", hostname="h", now=FIXED_NOW).decode()
        self.assertTrue(line.endswith(" TEST - hi"))


class ConfigTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        env = patch.dict(os.environ, {"DUI_DATA_DIR": self.tmp.name})
        env.start()
        self.addCleanup(env.stop)
        get_settings.cache_clear()
        self.addCleanup(get_settings.cache_clear)

    def test_round_trip(self) -> None:
        config = SyslogConfig(enabled=True, host="logs.lan", port=1514, protocol="tcp", users=False)
        save_syslog_config(config)
        self.assertEqual(load_syslog_config(), config)

    def test_broken_file_disables(self) -> None:
        get_settings().syslog_yaml.write_text("enabled: true\nport: 99999\n", encoding="utf-8")
        self.assertFalse(load_syslog_config().enabled)

    def test_host_required_when_enabled(self) -> None:
        with self.assertRaises(ValidationError):
            SyslogConfig(enabled=True, host="")
        SyslogConfig(enabled=False, host="")

    def test_host_rejects_junk(self) -> None:
        with self.assertRaises(ValidationError):
            SyslogConfig(host="evil host; rm")

    def test_hostname_is_server_display_name(self) -> None:
        get_settings().server_yaml.write_text(yaml.safe_dump({"name": " Home  DHCP\tBox "}), encoding="utf-8")
        self.assertEqual(message_hostname(), "Home-DHCP-Box")
        line = format_rfc5424(SyslogConfig(), Severity.INFO, "TEST", "hi").decode()
        self.assertEqual(line.split(" ")[2], "Home-DHCP-Box")

    def test_hostname_falls_back_when_name_unusable(self) -> None:
        get_settings().server_yaml.write_text(yaml.safe_dump({"name": "Büro"}), encoding="utf-8")
        self.assertEqual(message_hostname(), "Bro")
        get_settings().server_yaml.write_text(yaml.safe_dump({"name": "ÄÖÜ"}), encoding="utf-8")
        self.assertNotIn(" ", message_hostname())
        self.assertNotEqual(message_hostname(), "")

    def test_old_settings_file_with_removed_fields_still_loads(self) -> None:
        get_settings().syslog_yaml.write_text(
            "enabled: true\nhost: logs.lan\nfacility: local3\nhostname: box\n", encoding="utf-8"
        )
        config = load_syslog_config()
        self.assertTrue(config.enabled)
        self.assertNotIn("facility", config.model_dump())


class LeaseParserTests(unittest.TestCase):
    def test_ack_with_hostname(self) -> None:
        event = parse_dhcpd_line("DHCPACK on 10.0.0.5 to AA:bb:cc:dd:ee:ff (laptop) via eth0")
        assert event is not None
        self.assertEqual((event.event, event.ip, event.mac, event.hostname, event.via),
                         ("ack", "10.0.0.5", "aa:bb:cc:dd:ee:ff", "laptop", "eth0"))
        self.assertEqual(event.message, "Lease granted: 10.0.0.5 aa:bb:cc:dd:ee:ff (laptop) via eth0")

    def test_release_without_hostname(self) -> None:
        event = parse_dhcpd_line("Oct  8 12:00:00 dhcpd[1]: DHCPRELEASE of 10.0.0.5 from aa:bb:cc:dd:ee:ff via eth0 (found)")
        assert event is not None
        self.assertEqual((event.event, event.hostname, event.severity), ("release", None, Severity.INFO))

    def test_decline_and_nak(self) -> None:
        decline = parse_dhcpd_line("DHCPDECLINE of 10.0.0.9 from aa:bb:cc:dd:ee:01 (x) via eth0")
        nak = parse_dhcpd_line("DHCPNAK on 10.0.0.9 to aa:bb:cc:dd:ee:01 via 10.0.0.1")
        assert decline and nak
        self.assertEqual(decline.severity, Severity.WARNING)
        self.assertEqual((nak.event, nak.via), ("nak", "10.0.0.1"))

    def test_ignores_other_lines(self) -> None:
        for line in (
            "DHCPDISCOVER from aa:bb:cc:dd:ee:ff via eth0",
            "DHCPOFFER on 10.0.0.5 to aa:bb:cc:dd:ee:ff via eth0",
            "DHCPREQUEST for 10.0.0.5 from aa:bb:cc:dd:ee:ff via eth0",
            "DHCPACK to 10.0.0.5 (aa:bb:cc:dd:ee:ff) via eth0",  # DHCPINFORM reply, no lease
            "Listening on LPF/eth0/aa:bb:cc:dd:ee:ff/10.0.0.0/24",
        ):
            self.assertIsNone(parse_dhcpd_line(line), line)


class FakeEmitter(SyslogEmitter):
    def __init__(self, enabled: bool = True):
        super().__init__()
        self.enabled = enabled
        self.sent: list[tuple] = []

    def wants(self, category):  # type: ignore[override]
        return self.enabled

    def emit(self, category, msgid, severity, message, **params):  # type: ignore[override]
        self.sent.append((category, msgid, severity, message, params))


class LeaseWatcherTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.log = Path(self.tmp.name) / "dhcpd.log"

    def append(self, text: str) -> None:
        with self.log.open("a", encoding="utf-8") as handle:
            handle.write(text)

    def test_skips_history_and_follows_new_lines(self) -> None:
        self.append("DHCPACK on 10.0.0.1 to aa:bb:cc:dd:ee:01 via eth0\n")
        fake = FakeEmitter()
        watcher = LeaseLogWatcher(self.log, fake)
        self.assertEqual(watcher.poll(), [])
        self.append("DHCPACK on 10.0.0.2 to aa:bb:cc:dd:ee:02 via eth0\nDHCPRELEASE of 10.0.0.2 fr")
        self.assertEqual([e.ip for e in watcher.poll()], ["10.0.0.2"])
        self.append("om aa:bb:cc:dd:ee:02 via eth0\n")
        self.assertEqual([e.event for e in watcher.poll()], ["release"])
        self.assertEqual([s[4]["ip"] for s in fake.sent], ["10.0.0.2", "10.0.0.2"])

    def test_truncation_restarts_from_top(self) -> None:
        self.append("x" * 500 + "\n")
        watcher = LeaseLogWatcher(self.log, FakeEmitter())
        watcher.poll()
        self.log.write_text("DHCPACK on 10.0.0.3 to aa:bb:cc:dd:ee:03 via eth0\n", encoding="utf-8")
        self.assertEqual([e.ip for e in watcher.poll()], ["10.0.0.3"])

    def test_disabled_keeps_position_without_backlog(self) -> None:
        fake = FakeEmitter(enabled=False)
        watcher = LeaseLogWatcher(self.log, fake)
        watcher.poll()
        self.append("DHCPACK on 10.0.0.4 to aa:bb:cc:dd:ee:04 via eth0\n")
        self.assertEqual(watcher.poll(), [])
        fake.enabled = True
        self.assertEqual(watcher.poll(), [])
        self.assertEqual(fake.sent, [])


class SyslogApiTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.data_dir = Path(self.tmp.name)
        env = patch.dict(os.environ, {"DUI_DATA_DIR": str(self.data_dir)})
        env.start()
        self.addCleanup(env.stop)
        get_settings.cache_clear()
        self.addCleanup(get_settings.cache_clear)
        auth_routes.rate_limiter._attempts.clear()
        patch("app.dhcp.manager.validate_dhcpd_conf").start()
        patch("app.dhcp.manager.reload_dhcp_service").start()
        self.addCleanup(patch.stopall)
        (self.data_dir / "users.yaml").write_text(
            yaml.safe_dump(
                {
                    "users": [
                        {"username": "admin", "role": "admin", "password_hash": hash_password(ADMIN_PW)},
                        {"username": "viewer", "role": "viewer", "password_hash": hash_password(VIEWER_PW)},
                    ]
                }
            ),
            encoding="utf-8",
        )
        self.udp = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self.udp.bind(("127.0.0.1", 0))
        self.udp.settimeout(0.5)
        self.addCleanup(self.udp.close)
        self.port = self.udp.getsockname()[1]

    def login(self, username: str = "admin", password: str = ADMIN_PW) -> TestClient:
        client = TestClient(app)
        response = client.post("/api/auth/login", json={"username": username, "password": password})
        self.assertEqual(response.status_code, 200, response.text)
        client.headers["X-CSRF-Token"] = response.json()["csrf_token"]
        return client

    def enable(self, client: TestClient, **overrides) -> None:
        body = {"enabled": True, "host": "127.0.0.1", "port": self.port, "protocol": "udp", **overrides}
        response = client.put("/api/admin/syslog", json=body)
        self.assertEqual(response.status_code, 200, response.text)

    def received(self) -> list[str]:
        emitter.flush()
        lines = []
        while True:
            try:
                lines.append(self.udp.recv(65535).decode())
            except socket.timeout:
                return lines

    def test_disabled_by_default(self) -> None:
        admin = self.login()
        self.assertFalse(admin.get("/api/admin/syslog").json()["enabled"])
        self.assertEqual(self.received(), [])

    def test_viewer_cannot_touch_settings(self) -> None:
        viewer = self.login("viewer", VIEWER_PW)
        body = {"enabled": True, "host": "127.0.0.1", "port": self.port}
        self.assertEqual(viewer.get("/api/admin/syslog").status_code, 403)
        self.assertEqual(viewer.put("/api/admin/syslog", json=body).status_code, 403)
        self.assertEqual(viewer.post("/api/admin/syslog/test", json=body).status_code, 403)

    def test_enable_requires_host(self) -> None:
        response = self.login().put("/api/admin/syslog", json={"enabled": True, "host": ""})
        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.json()["detail"][0]["type"], "syslog.host_required")

    def test_events_reach_collector(self) -> None:
        admin = self.login()
        self.enable(admin)
        TestClient(app).post("/api/auth/login", json={"username": "admin", "password": "wrong"})
        self.login()
        subnet = {"network": "10.9.0.0/24", "name": "lab", "range": {"start": "10.9.0.10", "end": "10.9.0.50"}}
        self.assertEqual(admin.post("/api/config/subnets", json=subnet).status_code, 200)
        lines = self.received()
        self.assertTrue(any(" SETTINGS " in l and 'action="syslog"' in l for l in lines), lines)
        failed = next(l for l in lines if 'action="login_failed"' in l)
        self.assertTrue(failed.startswith("<28>1 "), failed)  # daemon warning
        self.assertIn('user="admin"', failed)
        self.assertNotIn("wrong", failed)
        self.assertTrue(any('action="login"' in l for l in lines), lines)
        self.assertTrue(any(" CONFIG " in l and 'network="10.9.0.0/24"' in l for l in lines), lines)

    def test_category_switch(self) -> None:
        admin = self.login()
        self.enable(admin, users=False)
        self.received()
        self.login()
        admin.post("/api/auth/users", json={"username": "carol", "role": "viewer", "password": "carol-password-1"})
        self.assertEqual(self.received(), [])

    def test_disable_stops_messages(self) -> None:
        admin = self.login()
        self.enable(admin)
        self.received()
        admin.put("/api/admin/syslog", json={"enabled": False, "host": "127.0.0.1", "port": self.port})
        self.login()
        self.assertEqual(self.received(), [])

    def test_test_message_uses_unsaved_settings(self) -> None:
        admin = self.login()
        response = admin.post("/api/admin/syslog/test", json={"enabled": False, "host": "127.0.0.1", "port": self.port})
        self.assertEqual(response.status_code, 200, response.text)
        lines = self.received()
        self.assertEqual(len(lines), 1)
        self.assertIn(" TEST ", lines[0])
        self.assertFalse(admin.get("/api/admin/syslog").json()["enabled"])

    def test_test_message_reports_tcp_failure(self) -> None:
        with socket.socket() as probe:
            probe.bind(("127.0.0.1", 0))
            closed_port = probe.getsockname()[1]
        response = self.login().post(
            "/api/admin/syslog/test", json={"host": "127.0.0.1", "port": closed_port, "protocol": "tcp"}
        )
        self.assertEqual(response.status_code, 502)
        self.assertEqual(response.json()["code"], "syslog.send_failed")

    def test_tcp_octet_counting(self) -> None:
        server = socket.socket()
        server.bind(("127.0.0.1", 0))
        server.listen(1)
        self.addCleanup(server.close)
        received = bytearray()

        def accept() -> None:
            conn, _ = server.accept()
            conn.settimeout(3)
            with conn:
                try:
                    while chunk := conn.recv(65535):
                        received.extend(chunk)
                except socket.timeout:
                    pass

        thread = threading.Thread(target=accept, daemon=True)
        thread.start()
        admin = self.login()
        self.enable(admin, protocol="tcp", port=server.getsockname()[1])
        emitter.flush()
        # Switching target closes the TCP connection, which ends the reader.
        self.enable(admin)
        emitter.flush()
        thread.join(5)
        length, _, rest = bytes(received).partition(b" ")
        self.assertEqual(int(length), len(rest), received)
        self.assertTrue(rest.startswith(b"<"), received)
        self.assertIn(b"SETTINGS", rest)


if __name__ == "__main__":
    unittest.main()
