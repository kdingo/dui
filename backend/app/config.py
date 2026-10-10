from functools import lru_cache
from pathlib import Path

import yaml
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="DUI_")

    data_dir: Path = Path("/data")
    logs_dir: Path = Path("/var/log/dui")
    interface: str = "eth0"
    http_port: int = 8080
    server_name: str = "DHCP UI"
    users_file: Path | None = None
    session_ttl_hours: int = 24
    login_rate_limit: int = 5
    login_rate_window_seconds: int = 900
    # The container entrypoint turns this on whenever nginx serves TLS.
    secure_cookies: bool = False

    @property
    def snapshots_dir(self) -> Path:
        return self.data_dir / "snapshots"

    @property
    def dhcpd_conf(self) -> Path:
        return self.data_dir / "dhcpd.conf"

    @property
    def dhcpd_leases(self) -> Path:
        # Own directory so the unprivileged dhcpd user can rewrite it without write access to /data.
        return self.data_dir / "leases" / "dhcpd.leases"

    @property
    def config_json(self) -> Path:
        return self.data_dir / "config.json"

    @property
    def server_yaml(self) -> Path:
        return self.data_dir / "server.yaml"

    @property
    def users_yaml(self) -> Path:
        return self.users_file or (self.data_dir / "users.yaml")

    @property
    def syslog_yaml(self) -> Path:
        return self.data_dir / "syslog.yaml"

    @property
    def session_secret_file(self) -> Path:
        return self.data_dir / "session.secret"

    @property
    def dhcpd_log(self) -> Path:
        return self.logs_dir / "dhcpd.log"

    @property
    def s6_dhcpd_service(self) -> Path:
        return Path("/run/service/dhcpd")

    @property
    def ctl_fifo(self) -> Path:
        """Command channel to the root-side dui-ctl service (see docker/s6-rc.d/dui-ctl)."""
        return Path("/run/dui-ctl/cmd")


@lru_cache
def get_settings() -> Settings:
    return Settings()


def load_server_name(settings: Settings | None = None) -> str:
    """The admin-chosen display name from server.yaml, else DUI_SERVER_NAME."""
    settings = settings or get_settings()
    if settings.server_yaml.exists():
        try:
            data = yaml.safe_load(settings.server_yaml.read_text(encoding="utf-8")) or {}
        except yaml.YAMLError:
            data = {}
        name = data.get("name") if isinstance(data, dict) else None
        if isinstance(name, str) and name.strip():
            return name
    return settings.server_name
