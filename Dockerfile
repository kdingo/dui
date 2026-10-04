# syntax=docker/dockerfile:1

# Base images are pinned by digest so a re-pushed tag can't change what gets built.
# To update: docker buildx imagetools inspect <image:tag>, then replace the digest.
FROM node:22-alpine@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402 AS frontend-build
WORKDIR /build
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM debian:bookworm-slim@sha256:3783cc01769c7b2b1b83a5c5ad96c815348e28ed7da68e2e3687004faa906251 AS runtime

ARG S6_OVERLAY_VERSION=3.2.3.0

ENV DEBIAN_FRONTEND=noninteractive

COPY backend/requirements.lock /tmp/requirements.lock
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    nginx \
    isc-dhcp-server \
    openssl \
    ca-certificates \
    xz-utils \
    bash \
    && pip3 install --no-cache-dir --break-system-packages --require-hashes -r /tmp/requirements.lock \
    && rm -rf /var/lib/apt/lists/* /tmp/requirements.lock

# Checksums from the s6-overlay release's .sha256 files; update them together with the version.
ADD --checksum=sha256:b720f9d9340efc8bb07528b9743813c836e4b02f8693d90241f047998b4c53cf \
    https://github.com/just-containers/s6-overlay/releases/download/v${S6_OVERLAY_VERSION}/s6-overlay-noarch.tar.xz /tmp/
ADD --checksum=sha256:a93f02882c6ed46b21e7adb5c0add86154f01236c93cd82c7d682722e8840563 \
    https://github.com/just-containers/s6-overlay/releases/download/v${S6_OVERLAY_VERSION}/s6-overlay-x86_64.tar.xz /tmp/
RUN tar -C / -Jxpf /tmp/s6-overlay-noarch.tar.xz && \
    tar -C / -Jxpf /tmp/s6-overlay-x86_64.tar.xz && \
    rm /tmp/s6-overlay-*.tar.xz

# Unprivileged accounts: `dui` runs the API, `dhcpd` is what dhcpd drops to after binding.
RUN groupadd --system dui && \
    useradd --system --gid dui --home-dir /nonexistent --no-create-home --shell /usr/sbin/nologin dui && \
    groupadd --system dhcpd && \
    useradd --system --gid dhcpd --home-dir /nonexistent --no-create-home --shell /usr/sbin/nologin dhcpd

WORKDIR /app

COPY backend/ /app/backend/
COPY docker/templates/ /etc/dui/templates/
COPY docker/nginx.conf /etc/dui/nginx.site.conf.template
COPY docker/s6-rc.d/ /etc/s6-overlay/s6-rc.d/
COPY docker/entrypoint.sh /entrypoint.sh
COPY --from=frontend-build /build/dist /usr/share/nginx/html

RUN chmod +x /entrypoint.sh /etc/s6-overlay/s6-rc.d/*/run && \
    mkdir -p /data /var/log/dui /var/log/nginx /var/lib/nginx/body /run/nginx && \
    rm -f /etc/nginx/sites-enabled/default

ENV DUI_INTERFACE=eth0 \
    DUI_HTTP_PORT=8067 \
    DUI_SERVER_NAME="DUI" \
    PYTHONPATH=/app/backend

VOLUME ["/data"]
EXPOSE 8067/tcp
EXPOSE 67/udp

ENTRYPOINT ["/entrypoint.sh"]
