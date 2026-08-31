# DHCP UI (DUI)

DHCP UI (DUI) is a Dockerized home-network DHCP server with a web management interface. It runs ISC `dhcpd` and a FastAPI + React UI in a single Debian bookworm-slim container.

## Features

- Dashboard with per-subnet lease utilization
- Lease viewer grouped by subnet
- Live DHCP log viewer
- Configure networks, fixed clients, and global options
- Import/export `dhcpd.conf` and `config.json` as a zip (preserves network names)
- Persistent config snapshots
- File-based user authentication with bcrypt hashes
- Server admin: manage users, control `dhcpd`, restart/stop container

## Quick start

1. Copy the example users file and set your admin password hash:

```bash
cp config/users.example.yaml config/users.yaml
```

Default credentials on first install: `admin` / `admin` (change the hash in `config/users.yaml`).

2. Edit `docker-compose.yml` and set `DUI_INTERFACE` to your host network interface.

3. Build and start:

```bash
docker compose up -d --build
```

4. Open the UI at `http://<host>:8080`

## Deployment notes

- Uses `network_mode: host` so DHCP broadcasts work on Linux.
- On Windows Docker Desktop, host networking behaves differently; build and run the stack on your Linux DHCP host for production use.
- Disable any existing DHCP server on your router or host before starting DUI.
- All persistent data is stored in the `dui-data` Docker volume under `/data`.
- Mount `config/users.yaml` read-only for safer deployments; mount read-write if you want the admin UI to edit users.

## Volume layout

```
/data/
  dhcpd.conf
  dhcpd.leases
  config.json
  users.yaml
  server.yaml
  session.secret
  snapshots/
  logs/dhcpd.log
```

## Local development

Backend:

```bash
cd backend
pip install -r requirements.txt
set DUI_DATA_DIR=../data
mkdir ../data
uvicorn app.main:app --reload --app-dir .
```

Frontend:

```bash
cd frontend
npm install
npm run dev
```

## Security

- Passwords are stored as bcrypt hashes in `users.yaml`
- Sessions use signed HttpOnly cookies
- CSRF protection on mutating API requests
- Login rate limiting

## License

MIT
