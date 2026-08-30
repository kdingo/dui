from __future__ import annotations

import json
import os
import shutil
import signal
import subprocess
from datetime import datetime, timezone
from pathlib import Path

from ..config import Settings, get_settings
from .conf_generator import generate_dhcpd_conf
from .conf_parser import parse_dhcpd_conf
from .models import DhcpConfig, SnapshotInfo
from .validator import DhcpValidationError, validate_dhcpd_conf


class ConfigManager:
    def __init__(self, settings: Settings | None = None):
        self.settings = settings or get_settings()

    def load_config(self) -> DhcpConfig:
        path = self.settings.config_json
        if not path.exists():
            if self.settings.dhcpd_conf.exists():
                config = parse_dhcpd_conf(self.settings.dhcpd_conf.read_text(encoding="utf-8"))
                self.save_config(config, apply=False)
                return config
            config = DhcpConfig.default_sample()
            self.save_config(config, apply=False)
            return config
        return DhcpConfig.model_validate_json(path.read_text(encoding="utf-8"))

    def save_config(self, config: DhcpConfig, apply: bool = True) -> None:
        snapshot_id = self.create_snapshot() if apply else None
        self.settings.config_json.write_text(
            config.model_dump_json(indent=2),
            encoding="utf-8",
        )
        conf_text = generate_dhcpd_conf(config)
        self.settings.dhcpd_conf.write_text(conf_text, encoding="utf-8")
        if apply:
            try:
                validate_dhcpd_conf(self.settings.dhcpd_conf)
            except DhcpValidationError:
                if snapshot_id:
                    self.restore_snapshot(snapshot_id)
                raise
            reload_dhcp_service(self.settings)

    def apply_config(self) -> None:
        snapshot_id = self.create_snapshot()
        try:
            validate_dhcpd_conf(self.settings.dhcpd_conf)
        except DhcpValidationError:
            self.restore_snapshot(snapshot_id)
            raise
        reload_dhcp_service(self.settings)

    def create_snapshot(self) -> str:
        snapshot_id = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        dest = self.settings.snapshots_dir / snapshot_id
        dest.mkdir(parents=True, exist_ok=True)
        if self.settings.dhcpd_conf.exists():
            shutil.copy2(self.settings.dhcpd_conf, dest / "dhcpd.conf")
        if self.settings.config_json.exists():
            shutil.copy2(self.settings.config_json, dest / "config.json")
        return snapshot_id

    def list_snapshots(self) -> list[SnapshotInfo]:
        if not self.settings.snapshots_dir.exists():
            return []
        items: list[SnapshotInfo] = []
        for entry in sorted(self.settings.snapshots_dir.iterdir(), reverse=True):
            if not entry.is_dir():
                continue
            items.append(
                SnapshotInfo(
                    id=entry.name,
                    created_at=entry.name,
                    has_config_json=(entry / "config.json").exists(),
                    has_dhcpd_conf=(entry / "dhcpd.conf").exists(),
                )
            )
        return items

    def restore_snapshot(self, snapshot_id: str) -> None:
        src = self.settings.snapshots_dir / snapshot_id
        if not src.exists():
            raise FileNotFoundError(f"Snapshot {snapshot_id} not found")
        if (src / "config.json").exists():
            shutil.copy2(src / "config.json", self.settings.config_json)
        if (src / "dhcpd.conf").exists():
            shutil.copy2(src / "dhcpd.conf", self.settings.dhcpd_conf)
        validate_dhcpd_conf(self.settings.dhcpd_conf)
        reload_dhcp_service(self.settings)

    def import_dhcpd_conf(self, content: str) -> DhcpConfig:
        config = parse_dhcpd_conf(content)
        self.settings.dhcpd_conf.write_text(content, encoding="utf-8")
        validate_dhcpd_conf(self.settings.dhcpd_conf)
        self.settings.config_json.write_text(config.model_dump_json(indent=2), encoding="utf-8")
        reload_dhcp_service(self.settings)
        return config

    def export_dhcpd_conf(self) -> str:
        if self.settings.dhcpd_conf.exists():
            return self.settings.dhcpd_conf.read_text(encoding="utf-8")
        config = self.load_config()
        return generate_dhcpd_conf(config)


def reload_dhcp_service(settings: Settings) -> None:
    service = settings.s6_dhcpd_service
    s6_svc = "/command/s6-svc"
    if service.exists():
        subprocess.run([s6_svc, "-h", str(service)], check=False)
        return
    # Fallback for local dev without s6
    subprocess.run(["pkill", "-HUP", "dhcpd"], check=False)


def dhcp_service_status(settings: Settings) -> dict[str, str | bool]:
    service = settings.s6_dhcpd_service
    s6_svstat = "/command/s6-svstat"
    s6_svc = "/command/s6-svc"
    if service.exists():
        result = subprocess.run([s6_svstat, str(service)], capture_output=True, text=True)
        running = result.returncode == 0 and " up " in result.stdout
        return {"managed_by": "s6", "running": running, "detail": result.stdout.strip()}
    result = subprocess.run(["pgrep", "-x", "dhcpd"], capture_output=True, text=True)
    running = result.returncode == 0
    return {"managed_by": "process", "running": running, "detail": result.stdout.strip()}


def control_dhcp_service(settings: Settings, action: str) -> None:
    service = settings.s6_dhcpd_service
    s6_svc = "/command/s6-svc"
    flag = {"start": "-u", "stop": "-d", "restart": "-t"}.get(action)
    if not flag:
        raise ValueError(f"Unknown action: {action}")
    if service.exists():
        subprocess.run([s6_svc, flag, str(service)], check=True)
        return
    if action == "stop":
        subprocess.run(["pkill", "-x", "dhcpd"], check=False)
    elif action == "start":
        subprocess.Popen(
            [
                "dhcpd",
                "-f",
                "-cf",
                str(settings.dhcpd_conf),
                "-lf",
                str(settings.dhcpd_leases),
                settings.interface,
            ]
        )
    elif action == "restart":
        subprocess.run(["pkill", "-x", "dhcpd"], check=False)
        subprocess.Popen(
            [
                "dhcpd",
                "-f",
                "-cf",
                str(settings.dhcpd_conf),
                "-lf",
                str(settings.dhcpd_leases),
                settings.interface,
            ]
        )


def stop_container() -> None:
    os.kill(1, signal.SIGTERM)


def restart_container() -> None:
    os.kill(1, signal.SIGINT)
