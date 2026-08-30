#!/bin/sh
set -e

DATA_DIR="${DUI_DATA_DIR:-/data}"
TEMPLATE_DIR="/etc/dui/templates"
HTTP_PORT="${DUI_HTTP_PORT:-8080}"

mkdir -p "$DATA_DIR/logs" "$DATA_DIR/snapshots"

if [ ! -f "$DATA_DIR/dhcpd.conf" ]; then
  cp "$TEMPLATE_DIR/dhcpd.conf" "$DATA_DIR/dhcpd.conf"
fi

if [ ! -f "$DATA_DIR/dhcpd.leases" ]; then
  touch "$DATA_DIR/dhcpd.leases"
fi

if [ ! -f "$DATA_DIR/server.yaml" ]; then
  if [ -n "$DUI_SERVER_NAME" ]; then
    printf 'name: %s\n' "$DUI_SERVER_NAME" > "$DATA_DIR/server.yaml"
  else
    cp "$TEMPLATE_DIR/server.yaml" "$DATA_DIR/server.yaml"
  fi
fi

if [ ! -f "$DATA_DIR/users.yaml" ]; then
  cp "$TEMPLATE_DIR/users.yaml" "$DATA_DIR/users.yaml"
fi

if [ ! -f "$DATA_DIR/config.json" ]; then
  python3 - <<'PY'
import json
from pathlib import Path
import sys
sys.path.insert(0, "/app/backend")
from app.dhcp.conf_parser import parse_dhcpd_conf
from app.dhcp.models import DhcpConfig

data_dir = Path("/data")
conf = data_dir / "dhcpd.conf"
if conf.exists():
    config = parse_dhcpd_conf(conf.read_text())
else:
    config = DhcpConfig.default_sample()
(data_dir / "config.json").write_text(config.model_dump_json(indent=2))
PY
fi

sed "s/listen 8080/listen ${HTTP_PORT}/" /etc/dui/nginx.site.conf.template > /etc/nginx/sites-available/dui.conf
ln -sf /etc/nginx/sites-available/dui.conf /etc/nginx/sites-enabled/dui.conf

mkdir -p /etc/cont-env
printf '%s' "${DUI_INTERFACE:-eth0}" > /etc/cont-env/DUI_INTERFACE
printf '%s' "${HTTP_PORT}" > /etc/cont-env/DUI_HTTP_PORT
printf '%s' "${DUI_SERVER_NAME:-DHCP UI (DUI)}" > /etc/cont-env/DUI_SERVER_NAME

chmod 644 "$DATA_DIR/dhcpd.conf" "$DATA_DIR/dhcpd.leases" 2>/dev/null || true

export PYTHONPATH="/app/backend"

exec /init
