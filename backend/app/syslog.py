"""Remote syslog: RFC 5424 messages over UDP or TCP for lease, server and user-activity events.

Admins configure the target in the UI (stored in ``/data/syslog.yaml``). Requests never wait on
the network: ``emit`` formats the message and queues it, and one daemon thread sends it. When the
target is unreachable, messages are dropped rather than piling up.
"""

from __future__ import annotations

import logging
import os
import queue
import re
import socket
import threading
import time
from datetime import datetime, timezone
from enum import IntEnum
from pathlib import Path
from typing import Any, Literal

import yaml
from fastapi import Request
from pydantic import BaseModel, Field, ValidationError, field_validator, model_validator

from .auth.users import get_client_ip
from .config import Settings, get_settings, load_server_name
from .errors import coded
from .fileutil import write_private_text

logger = logging.getLogger(__name__)

FACILITY_DAEMON = 3
Category = Literal["leases", "server", "users"]

# Structured-data ID: "name@<private enterprise number>"; 32473 is the PEN reserved for examples.
SD_ID = "dui@32473"
MAX_MESSAGE_CHARS = 1024
QUEUE_SIZE = 1000
SEND_TIMEOUT_SECONDS = 3.0
RETRY_AFTER_SECONDS = 5.0
REPORT_EVERY_SECONDS = 60.0

_HOST_PATTERN = re.compile(r"^[A-Za-z0-9._:\-]{1,253}$")
_PRINTABLE_PATTERN = r"^[!-~]+$"  # RFC 5424 header fields: printable US-ASCII, no spaces
_CONTROL_CHARS = re.compile(r"[\x00-\x1f\x7f]")


class Severity(IntEnum):
    EMERGENCY = 0
    ALERT = 1
    CRITICAL = 2
    ERROR = 3
    WARNING = 4
    NOTICE = 5
    INFO = 6
    DEBUG = 7


class SyslogConfig(BaseModel):
    enabled: bool = False
    host: str = Field(default="", max_length=253)
    port: int = Field(default=514, ge=1, le=65535)
    protocol: Literal["udp", "tcp"] = "udp"
    app_name: str = Field(default="dui", min_length=1, max_length=48, pattern=_PRINTABLE_PATTERN)
    leases: bool = True
    server: bool = True
    users: bool = True

    @field_validator("host")
    @classmethod
    def _check_host(cls, value: str) -> str:
        value = value.strip()
        if value and not _HOST_PATTERN.match(value):
            raise coded("validation.syslog_host", value=value)
        return value

    @model_validator(mode="after")
    def _host_when_enabled(self) -> SyslogConfig:
        if self.enabled and not self.host:
            raise coded("syslog.host_required")
        return self


def load_syslog_config(settings: Settings | None = None) -> SyslogConfig:
    path = (settings or get_settings()).syslog_yaml
    if not path.exists():
        return SyslogConfig()
    try:
        return SyslogConfig.model_validate(yaml.safe_load(path.read_text(encoding="utf-8")) or {})
    except (yaml.YAMLError, ValidationError, ValueError):
        logger.warning("ignoring invalid %s; syslog is disabled until it is saved again", path)
        return SyslogConfig()


def save_syslog_config(config: SyslogConfig, settings: Settings | None = None) -> None:
    path = (settings or get_settings()).syslog_yaml
    write_private_text(path, yaml.safe_dump(config.model_dump(), sort_keys=False))


# --- RFC 5424 ---------------------------------------------------------------------------------


def _header_hostname(name: str) -> str:
    # HOSTNAME must be printable US-ASCII without spaces: "Home DHCP" becomes "Home-DHCP".
    return re.sub(r"[^!-~]", "", re.sub(r"\s+", "-", name.strip()))[:255]


def message_hostname() -> str:
    """The server's display name, falling back to the container hostname if nothing usable is left."""
    return _header_hostname(load_server_name()) or _header_hostname(socket.gethostname()) or "-"


def _sd_escape(value: str) -> str:
    return re.sub(r'([\\"\]])', r"\\\1", value)


def _clean(text: str) -> str:
    return _CONTROL_CHARS.sub(" ", text)


def format_rfc5424(
    config: SyslogConfig,
    severity: Severity,
    msgid: str,
    message: str,
    params: dict[str, Any] | None = None,
    *,
    hostname: str | None = None,
    now: datetime | None = None,
) -> bytes:
    """``<PRI>1 TIMESTAMP HOSTNAME APP-NAME PROCID MSGID [SD] MSG`` as UTF-8, facility daemon."""
    pri = FACILITY_DAEMON * 8 + int(severity)
    stamp = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    timestamp = stamp.isoformat(timespec="milliseconds").replace("+00:00", "Z")
    hostname = hostname or message_hostname()
    pairs = [(k, _clean(str(v))) for k, v in (params or {}).items() if v is not None and v != ""]
    sd = f"[{SD_ID} " + " ".join(f'{k}="{_sd_escape(v)}"' for k, v in pairs) + "]" if pairs else "-"
    line = f"<{pri}>1 {timestamp} {hostname} {config.app_name} {os.getpid()} {msgid} {sd}"
    text = _clean(message)[:MAX_MESSAGE_CHARS]
    if text:
        line += f" {text}"
    return line.encode("utf-8")


def _frame(config: SyslogConfig, payload: bytes) -> bytes:
    # TCP uses octet-counting framing (RFC 6587): "<length> <message>".
    return f"{len(payload)} ".encode() + payload if config.protocol == "tcp" else payload


def _open_socket(config: SyslogConfig) -> socket.socket:
    socktype = socket.SOCK_STREAM if config.protocol == "tcp" else socket.SOCK_DGRAM
    error: OSError | None = None
    for family, _, proto, _, address in socket.getaddrinfo(config.host, config.port, type=socktype):
        sock = socket.socket(family, socktype, proto)
        sock.settimeout(SEND_TIMEOUT_SECONDS)
        try:
            sock.connect(address)
            return sock
        except OSError as exc:
            sock.close()
            error = exc
    raise error or OSError(f"cannot resolve {config.host}")


def send_now(config: SyslogConfig, severity: Severity, msgid: str, message: str, **params: Any) -> None:
    """Send one message synchronously on a fresh connection; raises OSError on failure."""
    with _open_socket(config) as sock:
        sock.sendall(_frame(config, format_rfc5424(config, severity, msgid, message, params)))


class SyslogEmitter:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._config: SyslogConfig | None = None
        self._config_path: Path | None = None
        self._queue: queue.Queue[tuple[SyslogConfig, bytes]] = queue.Queue(QUEUE_SIZE)
        self._thread: threading.Thread | None = None
        # Owned by the sender thread.
        self._sock: socket.socket | None = None
        self._sock_key: tuple[str, str, int] | None = None
        self._down_until = 0.0
        self._last_report = 0.0

    def config(self) -> SyslogConfig:
        path = get_settings().syslog_yaml
        with self._lock:
            if self._config is None or self._config_path != path:
                self._config = load_syslog_config()
                self._config_path = path
            return self._config

    def reconfigure(self, config: SyslogConfig) -> None:
        with self._lock:
            self._config = config
            self._config_path = get_settings().syslog_yaml
            self._down_until = 0.0

    def wants(self, category: Category) -> bool:
        config = self.config()
        return config.enabled and getattr(config, category)

    def emit(self, category: Category, msgid: str, severity: Severity, message: str, **params: Any) -> None:
        config = self.config()
        if not (config.enabled and getattr(config, category)):
            return
        payload = format_rfc5424(config, severity, msgid, message, params)
        self._ensure_thread()
        try:
            self._queue.put_nowait((config, payload))
        except queue.Full:
            self._report("syslog queue full; dropping messages")

    def flush(self, timeout: float = 2.0) -> None:
        """Wait (bounded) until queued messages have been handed to the network."""
        deadline = time.monotonic() + timeout
        while self._queue.unfinished_tasks and time.monotonic() < deadline:
            time.sleep(0.02)

    def _ensure_thread(self) -> None:
        with self._lock:
            if self._thread is None or not self._thread.is_alive():
                self._thread = threading.Thread(target=self._run, name="dui-syslog", daemon=True)
                self._thread.start()

    def _run(self) -> None:
        while True:
            config, payload = self._queue.get()
            try:
                self._send(config, payload)
            except OSError as exc:
                self._close()
                self._down_until = time.monotonic() + RETRY_AFTER_SECONDS
                self._report(f"syslog send to {config.host}:{config.port}/{config.protocol} failed: {exc}")
            finally:
                self._queue.task_done()

    def _send(self, config: SyslogConfig, payload: bytes) -> None:
        key = (config.protocol, config.host, config.port)
        if self._sock is None or self._sock_key != key:
            self._close()
            if time.monotonic() < self._down_until:
                return  # target was just unreachable; drop instead of retrying every message
            self._sock = _open_socket(config)
            self._sock_key = key
        self._sock.sendall(_frame(config, payload))

    def _close(self) -> None:
        if self._sock is not None:
            try:
                self._sock.close()
            except OSError:
                pass
        self._sock = None
        self._sock_key = None

    def _report(self, text: str) -> None:
        now = time.monotonic()
        if now - self._last_report >= REPORT_EVERY_SECONDS:
            self._last_report = now
            logger.warning(text)


emitter = SyslogEmitter()


def audit(
    category: Category,
    msgid: str,
    message: str,
    *,
    request: Request | None = None,
    user: dict[str, Any] | str | None = None,
    severity: Severity = Severity.INFO,
    **params: Any,
) -> None:
    """Emit an event, tagged with the acting user and client address when given."""
    tags: dict[str, Any] = {}
    if user is not None:
        tags["user"] = user if isinstance(user, str) else user.get("username")
    if request is not None:
        tags["ip"] = get_client_ip(request)
    emitter.emit(category, msgid, severity, message, **tags, **params)
