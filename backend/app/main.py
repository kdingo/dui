from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .routes import admin, auth, config, dashboard, leases, logs, snapshots

app = FastAPI(title="DHCP UI (DUI)", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

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
