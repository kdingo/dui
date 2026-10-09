from __future__ import annotations

import asyncio
import contextlib
from collections.abc import AsyncIterator

from fastapi import FastAPI

from .config import get_settings
from .dhcp.lease_events import LeaseLogWatcher
from .errors import register_handlers
from .routes import admin, auth, config, dashboard, leases, logs, snapshots


@contextlib.asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    # Uvicorn runs one worker, so exactly one watcher forwards lease events to syslog.
    watcher = asyncio.create_task(LeaseLogWatcher(get_settings().dhcpd_log).run())
    try:
        yield
    finally:
        watcher.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await watcher


# No CORS middleware: nginx (and the Vite dev proxy) serve the UI and API from one origin,
# so no cross-origin access is ever needed. Interactive docs are disabled to shrink the surface.
app = FastAPI(
    title="DHCP UI", version="1.0.0", docs_url=None, redoc_url=None, openapi_url=None, lifespan=lifespan
)
register_handlers(app)

app.include_router(auth.router)
app.include_router(dashboard.router)
app.include_router(leases.router)
app.include_router(logs.router)
app.include_router(config.router)
app.include_router(snapshots.router)
app.include_router(admin.router)


@app.get("/api/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}
