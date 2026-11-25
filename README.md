# CloudPulse

**Cloud infrastructure monitoring, alerting and anomaly detection — a full-stack reference implementation.**

CloudPulse is a self-contained monitoring platform built with React, TypeScript, Flask, scikit-learn and MongoDB (with a local SQLite fallback). It ships with a clearly-labelled demo fleet so the entire product can be explored immediately, and it can collect real telemetry from the machine it runs on or from remote hosts running the included agent.

> **Project status:** implemented and tested locally. A public **Vercel demo** is live at **https://cloudpulse-omega.vercel.app**. It runs in demo mode with simulated telemetry and an ephemeral serverless backend; it is not a production monitoring service. See [DEPLOYMENT.md](DEPLOYMENT.md).

---

## What is implemented

### Monitoring and visualization
- **Overview dashboard** with fleet health, availability, active incidents, resource KPIs, target matrix and socket pulse.
- **Infrastructure inventory** with search, status/type filters, pagination, detail drawer, per-target telemetry, availability, alert and anomaly evidence.
- **Live monitoring** with Socket.IO frame feed, pause/resume, aggregate streaming KPIs, per-target history, sparklines and collection controls.
- **Analytics** across 24h / 7d / 30d or a custom date range: trends, daily resource profile, per-target comparison, availability ranking, top consumers and cost run-rate estimates.
- **Alerts** with severity/category/target filters, pagination, lifecycle timeline, acknowledge and resolve with optional resolution notes.
- **Anomaly detection** with a per-target Isolation Forest model, anomaly score, robust z-score, dominant metric, run history and an honest methodology description.
- **Reports** with daily/weekly previews, branded PDF (ReportLab) and raw telemetry CSV export plus a report ledger.
- **Cloud services inventory** that explicitly separates actual, simulated, fallback, configuration-ready and conceptual capabilities.
- **Settings** for mode switching, collection interval, retention, thresholds, anomaly toggles, profile, password, users and appearance.

### Platform behaviour
- **Demo vs live is explicit.** Demo telemetry is simulated and labelled on every page where it appears. Live telemetry is collected with psutil by the local collector or remote agents. The backend never labels simulated data as real.
- **Threshold alerting** with configurable warning/critical boundaries, de-duplication per target/category, escalation from warning to critical, acknowledge/resolve lifecycle and evidence snapshots.
- **Availability watchdog** that marks stale targets offline and optionally auto-resolves availability incidents when heartbeats return.
- **Isolation Forest** anomaly detection (scikit-learn) with a 40-point minimum per target, persisted runs and duplicate suppression.
- **Health score** (0–100) computed from CPU, memory, disk, response time, availability and active alerts.
- **Authentication** with JWT bearer tokens, revocation on logout/password change, scrypt password hashing and admin/viewer roles.
- **Agent enrollment** with one-time `X-Agent-Key` values; only a one-way hash is stored.
- **Real-time events** over Flask-SocketIO for telemetry, alerts, anomalies, server changes, settings and mode changes.
- **Theme system** with three dark palettes, four accents and reduced-motion support, persisted locally.

---

## Architecture

```
┌─────────────────────────────┐        HTTPS / WSS        ┌──────────────────────────────┐
│  React + Vite + TypeScript  │ ────────────────────────▶ │  Flask REST API + Socket.IO  │
│  Tailwind + Recharts        │ ◀──────────────────────── │  JWT auth · workers          │
└─────────────────────────────┘        Socket.IO          └───────────┬──────────────────┘
                                                                      │
                       ┌──────────────────────────────────────────────┼─────────────────────────────┐
                       │                                              │                             │
              ┌────────▼─────────┐                          ┌─────────▼────────┐          ┌─────────▼─────────┐
              │ MongoDB Atlas    │  preferred               │ SQLite fallback  │          │ Telemetry sources │
              │ document store   │ ───────────────────────▶ │ JSON documents   │          │ demo generator    │
              └──────────────────┘                          └──────────────────┘          │ local psutil      │
                                                                                          │ remote agents     │
                                                                                          └───────────────────┘
```

The storage layer is abstracted behind a small document-store interface. When `MONGO_URI` is set and reachable, CloudPulse uses MongoDB; otherwise it automatically falls back to SQLite with JSON documents and reports which backend is active through `/api/health`, `/api/settings` and the Services page.

Background workers (demo generator or availability watchdog, anomaly scheduler and retention cleanup) run in-process. This keeps local setup simple but means the API must run as a **single process**; it is not designed for multi-worker horizontal scaling without a shared queue/scheduler.

---

## Repository layout

```
cloudpulse/
├── backend/
│   ├── app/
│   │   ├── routes/          REST blueprints (auth, servers, telemetry, alerts, …)
│   │   ├── services/        telemetry, alerts, anomalies, analytics, reports, db
│   │   ├── auth.py          JWT, password hashing, role decorators
│   │   ├── config.py        environment-driven configuration
│   │   └── __init__.py      app factory, Socket.IO, workers, seeding
│   ├── tests/               32 pytest integration/unit tests
│   ├── data/                SQLite fallback and logs (git-ignored)
│   ├── run.py               development / socketio runner
│   ├── wsgi.py              gunicorn entrypoint
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── components/      layout, UI primitives, charts
│   │   ├── context/         auth, socket, system, theme, toast
│   │   ├── pages/           ten routed pages
│   │   ├── lib/             API client, formatting, tests
│   │   └── test/            Vitest setup
│   ├── vercel.json
│   └── package.json
├── agent/cloudpulse_agent.py  standalone psutil agent
├── docs/API.md
├── render.yaml
├── DEPLOYMENT.md
└── README.md
```

---

## Quick start

### Prerequisites
- **Node.js 20+** and npm (Node 24 was used here).
- **Python 3.11+** with `venv` (Python 3.12 was used here).
- Optional: a MongoDB Atlas connection string. Without it, the SQLite fallback is used.

### 1. Backend

```powershell
cd cloudpulse/backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
Copy-Item .env.example .env
python run.py
```

On macOS/Linux:

```bash
cd cloudpulse/backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
python run.py
```

The API listens on `http://127.0.0.1:5000`. On first start it:
1. seeds settings and the admin account,
2. seeds eight demo targets and seven days of telemetry (if `SEED_DEMO_DATA=true`),
3. starts the demo generator, anomaly scheduler and retention worker.

### 2. Frontend

```powershell
cd cloudpulse/frontend
npm install
npm run dev
```

Open `http://localhost:5173`. The Vite dev server proxies `/api` and `/socket.io` to `http://127.0.0.1:5000`.

> On PowerShell systems where script execution blocks `npm.ps1`, use `npm.cmd install`, `npm.cmd run dev`, etc.

### 3. Sign in

Seeded administrator:

| Field | Value |
| --- | --- |
| Email | `admin@cloudpulse.dev` |
| Password | `Admin@12345` |

The login page also shows a one-click demo credential helper. New self-registered accounts receive the **viewer** role.

> Change the seeded password and set `SEED_ADMIN_PASSWORD` in any shared environment. The defaults exist for local evaluation only.

---

## Demo mode vs live mode

**Demo mode (default)** generates realistic simulated telemetry for eight targets (`srv-01` … `srv-08`, including an intentionally offline `legacy-app-04`). It exercises the real alerting, anomaly detection, reporting and socket pipelines. Simulated records carry `data_source: "simulated"` and are labelled in the UI.

**Live mode** hides demo targets, starts the local psutil collector and registers a `local-host` target. Only targets with live agent heartbeats are shown. Switching modes is an **admin-only** action available in the top bar or Settings, with an explicit confirmation.

Switching back to demo restores the demo fleet; live telemetry remains stored but is hidden under the current source. API calls can request `?source=all`, `?source=demo` or `?source=live` where supported.

### Enroll a remote host (live mode)

1. Switch to **Live** mode.
2. Open **Infrastructure → Add target** (admin only). Fill in the host details.
3. Copy the one-time agent key and command shown in the modal.
4. On the target host, install `psutil` and run the agent:

```bash
python3 -m pip install psutil
python3 agent/cloudpulse_agent.py \
  --url https://your-cloudpulse-api.example.com \
  --key cp_live_xxxxxxxxxxxxxxxxx \
  --interval 5
```

The agent sends real CPU, memory, disk, network, load and uptime metrics to `POST /api/telemetry/ingest` with the `X-Agent-Key` header. Rotating the key in the target drawer invalidates the previous key immediately. Use `--once` for a single collection (useful for testing).

---

## Tests

### Backend — 32 passing

```powershell
cd cloudpulse/backend
.\.venv\Scripts\python.exe -m pytest
```

```text
32 passed
```

Coverage includes authentication and roles, server CRUD and agent key rotation, telemetry ingestion and history, demo/live source separation, alert evaluation and lifecycle, anomaly detection, analytics, reports (summary/PDF/CSV), settings, health, OpenAPI, and service inventory honesty.

### Frontend — 17 passing

```powershell
cd cloudpulse/frontend
npm run test
```

```text
Test Files  2 passed (2)
     Tests  17 passed (17)
```

Coverage includes formatting, server and alert status mapping, relative dates, inclusive report ranges, class merging, badge rendering, button state, toggle semantics and progress-bar clamping.

### Build

```powershell
cd cloudpulse/frontend
npm run build
```

Produces a production bundle in `frontend/dist/`.

---

## Configuration

See [`backend/.env.example`](backend/.env.example) and [`frontend/.env.example`](frontend/.env.example) for the full list. Key variables:

| Variable | Purpose |
| --- | --- |
| `APP_ENV` | `development` or `production` (production requires `SECRET_KEY`). |
| `SECRET_KEY` | JWT signing key. Generated and persisted locally in development. |
| `MONGO_URI` / `MONGO_DB` | MongoDB Atlas connection; SQLite is used when empty/unreachable. |
| `ALLOWED_ORIGINS` | Comma-separated CORS allow-list for the frontend origin(s). |
| `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` | Initial administrator credentials. |
| `ENABLE_BACKGROUND_WORKERS` | Demo generator, anomaly scheduler, retention cleanup, watchdog. |
| `ENABLE_LOCAL_COLLECTOR` | psutil sampling of the backend host in live mode. |
| `MONITORING_INTERVAL` | Collection interval in seconds. |
| `AGENT_ENROLLMENT_TOKEN` | Optional remote self-enrollment token. |
| `VITE_API_URL` | Frontend API base; must include `/api`. Empty uses the dev proxy. |
| `VITE_SOCKET_URL` | Optional explicit Socket.IO origin. |

---

## Deployment

A public **Vercel demo** is live at **https://cloudpulse-omega.vercel.app**.

- **Deployed topology:** one Vercel project using Services — a Vite SPA and a Flask WSGI API on the same origin. Top-level rewrites send `/api/*` and `/socket.io/*` to the API.
- **Data:** Demo mode only. The backend seeds eight simulated targets with seven days of synthetic telemetry, and every screen labels it. SQLite lives in `/tmp` per Function instance, so data resets on cold start. Background workers and local collection are disabled.
- **Production path:** Render (`render.yaml`, single gunicorn process) plus MongoDB Atlas, with Vercel serving the SPA, remains the durable deployment option. It has **not** been deployed.

Full step-by-step instructions, environment matrices, verification commands and caveats are in [DEPLOYMENT.md](DEPLOYMENT.md).

---

## API

Interactive OpenAPI-style documentation is served at `GET /api/docs`; the machine-readable description is at `GET /api/openapi.json`. A concise reference is in [docs/API.md](docs/API.md).

Socket events: `telemetry:update`, `alert:new`, `alert:updated`, `server:created`, `server:updated`, `server:deleted`, `anomalies:updated`, `mode:changed`, `settings:updated`, `report:created`.

---

## Security notes

- Passwords use Werkzeug scrypt hashing; JWTs are signed with HS256 and can be revoked on logout or password change.
- Agent keys are random and stored as one-way hashes; the raw value is shown only once.
- Admin-only operations include target registration, deletion/key rotation, mode changes, threshold updates, user listing and manual anomaly scans.
- CORS is restricted by `ALLOWED_ORIGINS`; API responses set `Cache-Control: no-store`.
- For production, terminate TLS at the platform edge, set strong secrets, restrict Atlas network access and rotate seeded credentials. See [DEPLOYMENT.md](DEPLOYMENT.md).

---

## Honest limitations

- **Demo data is simulated.** It is labelled everywhere it appears, but it does not represent a real fleet.
- **Cloud provider integrations are conceptual.** AWS, Azure, GCP, CloudWatch and object-storage connectors are not implemented and require credentials that do not exist in this workspace.
- **MongoDB is optional.** Without Atlas, SQLite is a single-node fallback with no replication or backup guarantees.
- **Background work is process-local.** Run exactly one API worker; there is no Redis/Celery queue or cross-worker scheduler.
- **PDF reports are generated on demand** and not persisted server-side; only report ledger metadata is stored.
- **Cost figures are estimates** from configured hourly rates, not invoices.
- **Anomalies are statistical signals**, not confirmed incidents. Short histories and seasonal workloads can produce false positives.
- **The public Vercel demo is ephemeral.** It runs in demo mode with a per-instance SQLite file under `/tmp`, no background workers and no real collectors. Data resets on cold start, and logout/user changes are instance-local. Do not use it for production monitoring.
- **The Render + Atlas production path is not deployed.** Those steps have not been exercised against live platform accounts.
- **Email, SMS and PagerDuty notifications are not implemented.**

---

## License

This project is provided as a portfolio/reference implementation. Add a license appropriate to your use before redistribution.
