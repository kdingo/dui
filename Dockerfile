# syntax=docker/dockerfile:1

FROM node:22-alpine AS frontend-build
WORKDIR /build
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm install
COPY frontend/ ./
RUN npm run build

FROM debian:bookworm-slim AS runtime

ARG S6_OVERLAY_VERSION=3.2.3.0

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    nginx \
    isc-dhcp-server \
    curl \
    ca-certificates \
    xz-utils \
    bash \
    && pip3 install --no-cache-dir --break-system-packages \
    fastapi==0.115.6 \
    "uvicorn[standard]==0.34.0" \
    pyyaml==6.0.2 \
    bcrypt==4.2.1 \
    itsdangerous==2.2.0 \
    python-multipart==0.0.20 \
    pydantic==2.10.4 \
    pydantic-settings==2.7.0 \
    && rm -rf /var/lib/apt/lists/*

ADD https://github.com/just-containers/s6-overlay/releases/download/v${S6_OVERLAY_VERSION}/s6-overlay-noarch.tar.xz /tmp/
ADD https://github.com/just-containers/s6-overlay/releases/download/v${S6_OVERLAY_VERSION}/s6-overlay-x86_64.tar.xz /tmp/
RUN tar -C / -Jxpf /tmp/s6-overlay-noarch.tar.xz && \
    tar -C / -Jxpf /tmp/s6-overlay-x86_64.tar.xz && \
    rm /tmp/s6-overlay-*.tar.xz

WORKDIR /app

COPY backend/ /app/backend/
COPY docker/templates/ /etc/dui/templates/
COPY docker/nginx.conf /etc/dui/nginx.site.conf.template
COPY docker/s6-rc.d/ /etc/s6-overlay/s6-rc.d/
COPY docker/entrypoint.sh /entrypoint.sh
COPY --from=frontend-build /build/dist /usr/share/nginx/html

RUN chmod +x /entrypoint.sh /etc/s6-overlay/s6-rc.d/dhcpd/run /etc/s6-overlay/s6-rc.d/dui-api/run /etc/s6-overlay/s6-rc.d/nginx/run && \
    mkdir -p /data /var/log/dui /var/log/nginx /var/lib/nginx/body /run/nginx && \
    rm -f /etc/nginx/sites-enabled/default

ENV DUI_INTERFACE=eth0 \
    DUI_HTTP_PORT=8067 \
    DUI_SERVER_NAME="DHCP UI (DUI)" \
    PYTHONPATH=/app/backend

VOLUME ["/data"]
EXPOSE 8067/tcp
EXPOSE 67/udp

ENTRYPOINT ["/entrypoint.sh"]
