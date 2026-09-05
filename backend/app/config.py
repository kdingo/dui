from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="DUI_")

    data_dir: Path = Path("/data")
    logs_dir: Path = Path("/var/log/dui")
    interface: str = "eth0"
    http_port: int = 8080
    server_name: str = "DHCP UI (DUI)"
    users_file: Path | None = None
    session_ttl_hours: int = 24
    login_rate_limit: int = 5
    login_rate_window_seconds: int = 900

    @property
    def snapshots_dir(self) -> Path:
        return self.data_dir / "snapshots"

    @property
    def dhcpd_conf(self) -> Path:
        return self.data_dir / "dhcpd.conf"

    @property
    def dhcpd_leases(self) -> Path:
        return self.data_dir / "dhcpd.leases"

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
    def session_secret_file(self) -> Path:
        return self.data_dir / "session.secret"

    @property
    def dhcpd_log(self) -> Path:
        return self.logs_dir / "dhcpd.log"

    @property
    def s6_dhcpd_service(self) -> Path:
        return Path("/run/service/dhcpd")


@lru_cache
def get_settings() -> Settings:
    return Settings()
