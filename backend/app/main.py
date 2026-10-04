from __future__ import annotations

from fastapi import FastAPI

from .routes import admin, auth, config, dashboard, leases, logs, snapshots

# No CORS middleware: nginx (and the Vite dev proxy) serve the UI and API from one origin,
# so no cross-origin access is ever needed. Interactive docs are disabled to shrink the surface.
app = FastAPI(title="DHCP UI", version="1.0.0", docs_url=None, redoc_url=None, openapi_url=None)

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
