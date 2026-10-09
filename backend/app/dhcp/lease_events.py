"""Turns lease changes in dhcpd's log into syslog events.

dhcpd writes to stderr (there is no syslog daemon in the image) and the s6 service appends that to
dhcpd.log, so the log file is the one place lease activity shows up as it happens.
"""

from __future__ import annotations

import asyncio
import logging
import os
import re
from dataclasses import dataclass
from pathlib import Path

from ..syslog import Severity, SyslogEmitter, emitter as default_emitter

logger = logging.getLogger(__name__)

POLL_SECONDS = 1.0
MAX_READ_BYTES = 1024 * 1024

_TAIL = r"(?P<ip>[0-9a-fA-F.:]+) (?:to|from) (?P<mac>[0-9a-fA-F:]+)(?: \((?P<hostname>[^)]*)\))? via (?P<via>\S+)"
_PATTERNS: list[tuple[re.Pattern[str], str, Severity, str]] = [
    (re.compile(r"DHCPACK on " + _TAIL), "ack", Severity.INFO, "Lease granted"),
    (re.compile(r"DHCPRELEASE of " + _TAIL), "release", Severity.INFO, "Lease released"),
    (re.compile(r"DHCPDECLINE of " + _TAIL), "decline", Severity.WARNING, "Address declined"),
    (re.compile(r"DHCPNAK on " + _TAIL), "nak", Severity.NOTICE, "Lease refused"),
]


@dataclass
class LeaseEvent:
    event: str
    severity: Severity
    summary: str
    ip: str
    mac: str
    hostname: str | None
    via: str

    @property
    def message(self) -> str:
        who = f"{self.mac} ({self.hostname})" if self.hostname else self.mac
        return f"{self.summary}: {self.ip} {who} via {self.via}"


def parse_dhcpd_line(line: str) -> LeaseEvent | None:
    for pattern, event, severity, summary in _PATTERNS:
        match = pattern.search(line)
        if match:
            return LeaseEvent(
                event=event,
                severity=severity,
                summary=summary,
                ip=match["ip"],
                mac=match["mac"].lower(),
                hostname=match["hostname"] or None,
                via=match["via"],
            )
    return None


class LeaseLogWatcher:
    """Follows dhcpd.log from its current end, coping with truncation and replacement."""

    def __init__(self, path: Path, emitter: SyslogEmitter | None = None):
        self.path = path
        self.emitter = emitter or default_emitter
        self._pos: int | None = None  # None until the first poll: skip what's already logged
        self._inode: int | None = None
        self._partial = b""

    def poll(self) -> list[LeaseEvent]:
        try:
            st = os.stat(self.path)
        except FileNotFoundError:
            # Anything written to a file that appears later is new.
            self._pos, self._inode, self._partial = 0, None, b""
            return []
        if self._pos is None:
            self._pos, self._inode = st.st_size, st.st_ino
            return []
        if st.st_ino != self._inode or st.st_size < self._pos:
            self._pos, self._inode, self._partial = 0, st.st_ino, b""
        if st.st_size == self._pos:
            return []
        if not self.emitter.wants("leases"):
            # Stay current so turning syslog on later doesn't replay a backlog.
            self._pos, self._partial = st.st_size, b""
            return []
        with open(self.path, "rb") as handle:
            handle.seek(self._pos)
            chunk = handle.read(MAX_READ_BYTES)
        self._pos += len(chunk)
        data = self._partial + chunk
        lines = data.split(b"\n")
        self._partial = lines.pop()
        events = []
        for raw in lines:
            event = parse_dhcpd_line(raw.decode("utf-8", errors="replace"))
            if event:
                events.append(event)
                self.emitter.emit(
                    "leases",
                    "LEASE",
                    event.severity,
                    event.message,
                    event=event.event,
                    ip=event.ip,
                    mac=event.mac,
                    hostname=event.hostname,
                    via=event.via,
                )
        return events

    async def run(self, interval: float = POLL_SECONDS) -> None:
        while True:
            try:
                await asyncio.to_thread(self.poll)
            except Exception:
                logger.exception("lease log watcher failed")
            await asyncio.sleep(interval)
