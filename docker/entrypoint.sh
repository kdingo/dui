#!/bin/sh
set -e

DATA_DIR="${DUI_DATA_DIR:-/data}"
LOGS_DIR="${DUI_LOGS_DIR:-/var/log/dui}"
TEMPLATE_DIR="/etc/dui/templates"
HTTP_PORT="${DUI_HTTP_PORT:-8080}"
TLS="${DUI_TLS:-true}"
LEASES_DIR="$DATA_DIR/leases"

mkdir -p "$DATA_DIR" "$DATA_DIR/snapshots" "$LEASES_DIR" "$LOGS_DIR" /run/dhcpd

touch "$LOGS_DIR/dhcpd.log"

if [ ! -f "$DATA_DIR/dhcpd.conf" ] && [ ! -f "$DATA_DIR/config.json" ]; then
  cp "$TEMPLATE_DIR/dhcpd.conf" "$DATA_DIR/dhcpd.conf"
fi

# Leases live in their own directory so dhcpd can drop to an unprivileged user that owns
# only that directory. Move the file there on upgrade from older releases.
if [ -f "$DATA_DIR/dhcpd.leases" ] && [ ! -f "$LEASES_DIR/dhcpd.leases" ]; then
  mv "$DATA_DIR/dhcpd.leases" "$LEASES_DIR/dhcpd.leases"
fi
rm -f "$DATA_DIR/dhcpd.leases~"
touch "$LEASES_DIR/dhcpd.leases"

if [ ! -f "$DATA_DIR/server.yaml" ]; then
  if [ -n "$DUI_SERVER_NAME" ]; then
    printf 'name: %s\n' "$DUI_SERVER_NAME" > "$DATA_DIR/server.yaml"
  else
    cp "$TEMPLATE_DIR/server.yaml" "$DATA_DIR/server.yaml"
  fi
fi

export PYTHONPATH="/app/backend"
export DUI_DATA_DIR="$DATA_DIR"

# First start: create the admin with a random one-time password (or DUI_ADMIN_PASSWORD).
python3 -m app.auth.cli init
# Never hand the bootstrap password on to the running services.
unset DUI_ADMIN_PASSWORD

# Validate config.json and regenerate dhcpd.conf from it.
python3 -m app.startup

# --- TLS --------------------------------------------------------------------------------
LISTEN="${DUI_BIND_ADDRESS:+$DUI_BIND_ADDRESS:}${HTTP_PORT}"
if [ "$TLS" = "true" ]; then
  CERT="${DUI_TLS_CERT:-$DATA_DIR/tls/cert.pem}"
  KEY="${DUI_TLS_KEY:-$DATA_DIR/tls/key.pem}"
  if [ ! -f "$CERT" ] || [ ! -f "$KEY" ]; then
    if [ -n "$DUI_TLS_CERT" ] || [ -n "$DUI_TLS_KEY" ]; then
      echo "DUI: DUI_TLS_CERT/DUI_TLS_KEY point to missing files" >&2
      exit 1
    fi
    mkdir -p "$DATA_DIR/tls"
    echo "DUI: generating a self-signed TLS certificate in $DATA_DIR/tls"
    openssl req -x509 -newkey rsa:2048 -nodes -days 3650 -subj "/CN=${DUI_SERVER_NAME:-dui}" \
      -keyout "$KEY" -out "$CERT" 2>/dev/null
  fi
  cat > /etc/nginx/dui-tls.conf <<EOF
ssl_certificate $CERT;
ssl_certificate_key $KEY;
ssl_protocols TLSv1.2 TLSv1.3;
ssl_session_cache shared:dui_tls:1m;
# Plain HTTP sent to the HTTPS port gets redirected instead of an error page.
error_page 497 =301 https://\$host:\$server_port\$request_uri;
EOF
  LISTEN="$LISTEN ssl"
  export DUI_SECURE_COOKIES=true
else
  echo "DUI WARNING: DUI_TLS=false - passwords and session cookies cross the network unencrypted" >&2
  : > /etc/nginx/dui-tls.conf
  export DUI_SECURE_COOKIES=false
fi

sed "s/__LISTEN__/${LISTEN}/" /etc/dui/nginx.site.conf.template > /etc/nginx/sites-available/dui.conf
ln -sf /etc/nginx/sites-available/dui.conf /etc/nginx/sites-enabled/dui.conf

# --- Ownership: the API runs as `dui`, dhcpd drops to `dhcpd` -----------------------------
chown -R dui:dui "$DATA_DIR"
chmod 0751 "$DATA_DIR"  # others may traverse (dhcpd -> leases/) but not list
chown -R dhcpd:dhcpd "$LEASES_DIR" /run/dhcpd
chmod 0755 "$LEASES_DIR"
if [ -d "$DATA_DIR/tls" ]; then
  chown -R root:root "$DATA_DIR/tls"
  chmod 0700 "$DATA_DIR/tls"
  chmod 0600 "$DATA_DIR/tls/"*
fi
for secret in "$DATA_DIR/users.yaml" "$DATA_DIR/session.secret"; do
  if [ -f "$secret" ]; then chmod 0600 "$secret"; fi
done
chmod 0644 "$DATA_DIR/dhcpd.conf"
chmod 0644 "$LOGS_DIR/dhcpd.log"

exec /init
