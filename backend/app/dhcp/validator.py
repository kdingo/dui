from __future__ import annotations

import subprocess
from pathlib import Path


class DhcpValidationError(Exception):
    code = "dhcp.validation_failed"

    def __init__(self, message: str, output: str = ""):
        super().__init__(message)
        self.output = output


def validate_dhcpd_conf(conf_path: Path) -> str:
    result = subprocess.run(
        ["dhcpd", "-t", "-cf", str(conf_path)],
        capture_output=True,
        text=True,
    )
    output = (result.stdout or "") + (result.stderr or "")
    if result.returncode != 0:
        raise DhcpValidationError("dhcpd configuration validation failed", output)
    return output.strip()
