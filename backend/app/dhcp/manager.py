from __future__ import annotations

import io
import os
import shutil
import signal
import subprocess
import zipfile
from datetime import datetime, timezone
from pathlib import Path

import yaml

from ..config import Settings, get_settings
from .conf_generator import generate_dhcpd_conf
from .conf_parser import parse_dhcpd_conf
from .models import DhcpConfig, SnapshotInfo
from .validator import DhcpValidationError, validate_dhcpd_conf

# Only DHCP configuration travels in a bundle. users.yaml and session.secret never leave or
# enter through it: an exported secret lets anyone forge sessions, and an imported one is a backdoor.
BUNDLE_FILES = ("dhcpd.conf", "config.json", "server.yaml")
MAX_BUNDLE_MEMBERS = 1000
MAX_BUNDLE_BYTES = 10 * 1024 * 1024


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

    def _write_config(self, config: DhcpConfig) -> None:
        conf_text = generate_dhcpd_conf(config)
        self.settings.config_json.write_text(config.model_dump_json(indent=2), encoding="utf-8")
        self.settings.dhcpd_conf.write_text(conf_text, encoding="utf-8")

    def save_config(self, config: DhcpConfig, apply: bool = True) -> None:
        snapshot_id = self.create_snapshot() if apply else None
        self._write_config(config)
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

    def _snapshot_dir(self, snapshot_id: str) -> Path:
        base = self.settings.snapshots_dir.resolve()
        src = (self.settings.snapshots_dir / snapshot_id).resolve()
        if src != base and base not in src.parents:
            raise FileNotFoundError(f"Snapshot {snapshot_id} not found")
        if not src.is_dir():
            raise FileNotFoundError(f"Snapshot {snapshot_id} not found")
        return src

    def restore_snapshot(self, snapshot_id: str) -> None:
        src = self._snapshot_dir(snapshot_id)
        # Rebuild dhcpd.conf from validated data rather than copying it, so a snapshot holding a
        # hand-edited or older unsafe dhcpd.conf can't reintroduce raw statements.
        if (src / "config.json").exists():
            config = DhcpConfig.model_validate_json((src / "config.json").read_text(encoding="utf-8"))
        elif (src / "dhcpd.conf").exists():
            config = parse_dhcpd_conf((src / "dhcpd.conf").read_text(encoding="utf-8"))
        else:
            raise FileNotFoundError(f"Snapshot {snapshot_id} is empty")
        self._write_config(config)
        validate_dhcpd_conf(self.settings.dhcpd_conf)
        reload_dhcp_service(self.settings)

    def delete_snapshot(self, snapshot_id: str) -> None:
        shutil.rmtree(self._snapshot_dir(snapshot_id))

    def read_snapshot_dhcpd_conf(self, snapshot_id: str) -> str:
        conf = self._snapshot_dir(snapshot_id) / "dhcpd.conf"
        if not conf.is_file():
            raise FileNotFoundError(f"Snapshot {snapshot_id} has no dhcpd.conf")
        return conf.read_text(encoding="utf-8")

    def import_dhcpd_conf(self, content: str) -> DhcpConfig:
        # Parse into the validated model and regenerate; the uploaded text is never written as-is.
        config = parse_dhcpd_conf(content)
        self.save_config(config, apply=True)
        return config

    def export_dhcpd_conf(self) -> str:
        if self.settings.dhcpd_conf.exists():
            return self.settings.dhcpd_conf.read_text(encoding="utf-8")
        config = self.load_config()
        return generate_dhcpd_conf(config)

    def export_bundle(self) -> bytes:
        data_dir = self.settings.data_dir
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            for name in BUNDLE_FILES:
                path = data_dir / name
                if path.is_file():
                    archive.write(path, name)
        return buffer.getvalue()

    def import_bundle(self, zip_bytes: bytes) -> DhcpConfig:
        members = _read_data_zip(zip_bytes)
        if "dhcpd.conf" not in members:
            raise ValueError("Zip archive is missing dhcpd.conf")
        if "config.json" in members:
            config = DhcpConfig.model_validate_json(members["config.json"])
        else:
            config = parse_dhcpd_conf(members["dhcpd.conf"].decode("utf-8"))
        if "server.yaml" in members:
            self._import_server_yaml(members["server.yaml"])
        self.save_config(config, apply=True)
        return self.load_config()

    def _import_server_yaml(self, raw: bytes) -> None:
        try:
            data = yaml.safe_load(raw.decode("utf-8")) or {}
        except (yaml.YAMLError, UnicodeDecodeError) as exc:
            raise ValueError("server.yaml in the zip is not valid YAML") from exc
        name = data.get("name") if isinstance(data, dict) else None
        if not isinstance(name, str) or not name.strip() or len(name) > 128:
            raise ValueError("server.yaml in the zip must contain a short 'name'")
        self.settings.server_yaml.write_text(yaml.safe_dump({"name": name.strip()}), encoding="utf-8")


def _safe_zip_dest(root: Path, name: str) -> Path:
    normalized = name.replace("\\", "/").strip("/")
    if not normalized or normalized == ".":
        raise ValueError(f"Unsafe zip member path: {name}")
    if normalized.startswith("../") or "/../" in f"/{normalized}/":
        raise ValueError(f"Unsafe zip member path: {name}")
    candidate = Path(normalized)
    if candidate.is_absolute() or any(part == ".." or ":" in part for part in candidate.parts):
        raise ValueError(f"Unsafe zip member path: {name}")
    dest = (root / candidate).resolve()
    if not dest.is_relative_to(root.resolve()):
        raise ValueError(f"Unsafe zip member path: {name}")
    return dest


def _read_data_zip(zip_bytes: bytes) -> dict[str, bytes]:
    """Return the allowlisted top-level files of a bundle; every other member is ignored."""
    try:
        archive = zipfile.ZipFile(io.BytesIO(zip_bytes))
    except zipfile.BadZipFile as exc:
        raise ValueError("Invalid zip file") from exc

    check_root = Path("/bundle")
    members: dict[str, bytes] = {}
    total = 0
    with archive:
        infos = archive.infolist()
        if len(infos) > MAX_BUNDLE_MEMBERS:
            raise ValueError("Zip archive has too many entries")
        for info in infos:
            name = info.filename.replace("\\", "/")
            _safe_zip_dest(check_root, name.rstrip("/"))
            if info.is_dir() or name not in BUNDLE_FILES:
                continue
            # Read at most the remaining budget + 1 byte so a zip bomb can't exhaust memory.
            with archive.open(info) as src:
                data = src.read(MAX_BUNDLE_BYTES - total + 1)
            total += len(data)
            if total > MAX_BUNDLE_BYTES:
                raise ValueError("Zip archive is too large")
            members[name] = data
    return members


def _send_ctl(settings: Settings, command: str) -> bool:
    """Ask the root-side dui-ctl service to act. Returns False when it doesn't exist (local dev).

    The API runs unprivileged inside the container; this one-way FIFO is its only way to steer
    dhcpd or PID 1, and dui-ctl acts only on a fixed set of command words.
    """
    fifo = settings.ctl_fifo
    if not fifo.exists():
        return False
    try:
        fd = os.open(fifo, os.O_WRONLY | os.O_NONBLOCK)
    except OSError as exc:
        raise RuntimeError("dui-ctl service is not running") from exc
    try:
        os.write(fd, f"{command}\n".encode())
    finally:
        os.close(fd)
    return True


def reload_dhcp_service(settings: Settings) -> None:
    if _send_ctl(settings, "dhcp-reload"):
        return
    service = settings.s6_dhcpd_service
    if service.exists():
        subprocess.run(["/command/s6-svc", "-h", str(service)], check=False)
        return
    # Fallback for local dev without s6
    subprocess.run(["pkill", "-HUP", "dhcpd"], check=False)


def s6_svstat_is_running(svstat_output: str) -> bool:
    """s6-svstat prints 'up ...' or 'down ..., normally up'; only the first token is the state."""
    token = svstat_output.strip().split(None, 1)
    return bool(token) and token[0] == "up"


def dhcp_service_status(settings: Settings) -> dict[str, str | bool]:
    service = settings.s6_dhcpd_service
    s6_svstat = "/command/s6-svstat"
    if service.exists():
        result = subprocess.run([s6_svstat, str(service)], capture_output=True, text=True)
        detail = result.stdout.strip()
        running = result.returncode == 0 and s6_svstat_is_running(detail)
        return {"managed_by": "s6", "running": running, "detail": detail}
    result = subprocess.run(["pgrep", "-x", "dhcpd"], capture_output=True, text=True)
    running = result.returncode == 0
    return {"managed_by": "process", "running": running, "detail": result.stdout.strip()}


def control_dhcp_service(settings: Settings, action: str) -> None:
    flag = {"start": "-u", "stop": "-d", "restart": "-t"}.get(action)
    if not flag:
        raise ValueError(f"Unknown action: {action}")
    if _send_ctl(settings, f"dhcp-{action}"):
        return
    service = settings.s6_dhcpd_service
    if service.exists():
        subprocess.run(["/command/s6-svc", flag, str(service)], check=True)
        return
    if action == "stop":
        subprocess.run(["pkill", "-x", "dhcpd"], check=False)
    elif action == "start":
        _start_dhcpd_process(settings)
    elif action == "restart":
        subprocess.run(["pkill", "-x", "dhcpd"], check=False)
        _start_dhcpd_process(settings)


def _start_dhcpd_process(settings: Settings) -> None:
    settings.logs_dir.mkdir(parents=True, exist_ok=True)
    log_handle = settings.dhcpd_log.open("a", encoding="utf-8")
    try:
        subprocess.Popen(
            [
                "dhcpd",
                "-d",
                "-f",
                "-cf",
                str(settings.dhcpd_conf),
                "-lf",
                str(settings.dhcpd_leases),
                settings.interface,
            ],
            stdout=log_handle,
            stderr=log_handle,
            start_new_session=True,
        )
    finally:
        log_handle.close()


def stop_container() -> None:
    if not _send_ctl(get_settings(), "container-stop"):
        os.kill(1, signal.SIGTERM)


def restart_container() -> None:
    if not _send_ctl(get_settings(), "container-restart"):
        os.kill(1, signal.SIGINT)
