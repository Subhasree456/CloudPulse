# CloudPulse deployment guide

> ## Deployment status: **DEPLOYED — Vercel serverless demo**
>
> | Item | Value |
> | --- | --- |
> | Public URL | **https://cloudpulse-omega.vercel.app** |
> | Vercel project | `warrior-074c/cloudpulse` |
> | Topology | One Vercel project using Services: Vite SPA + Flask WSGI API |
> | Data | **Demo mode** — simulated telemetry, clearly labelled across the UI |
> | Verified | 2026-11-23 |
>
> This is a **demonstration deployment**, not a production monitoring service. It runs without a persistent database, background workers or real collectors. See [Deployed topology](#deployed-topology-vercel-serverless-demo) and [Known deployment limitations](#7-known-deployment-limitations).

---

## Deployed topology (Vercel serverless demo)

The live demo uses one Vercel project with two [Services](https://vercel.com/docs/services):

| Service | Root | Runtime | Purpose |
| --- | --- | --- | --- |
| `frontend` | `frontend/` | Vite static build | React SPA; same-origin `/api` and `/socket.io` |
| `api` | `backend/` | Python 3.12 Flask WSGI (`wsgi:app`) | REST API, JWT auth, demo seeding, PDF/CSV reports |

Top-level rewrites in `vercel.json` route `/api/*` and `/socket.io/*` to the API service and everything else to the frontend. Because both are on the same origin, no `VITE_API_URL` or `VITE_SOCKET_URL` is required.

### Demo-only configuration

These production environment variables are set on the Vercel project:

| Variable | Value | Why |
| --- | --- | --- |
| `APP_ENV` | `production` | Enables production secret checks |
| `SECRET_KEY` | generated secret | Stable JWT signing key |
| `DATA_DIR` / `DATABASE_PATH` / `LOG_DIR` | `/tmp/cloudpulse...` | Writable path inside a Vercel Function |
| `ENABLE_BACKGROUND_WORKERS` | `false` | Vercel Functions are not a durable worker host |
| `ENABLE_LOCAL_COLLECTOR` | `false` | The function is not a monitored host |
| `AUTO_SEED` / `SEED_DEMO_DATA` | `true` | Creates the clearly labelled demo fleet |
| `DEMO_MODE_DEFAULT` | `demo` | Starts in demo mode |
| `ALLOWED_ORIGINS` | `*` | Same-origin demo; tighten for any real deployment |

### What the demo does and does not do

- It seeds **eight simulated targets** with seven days of synthetic telemetry, alerts, anomalies and reports.
- The UI displays **Demo data** and a demo-mode banner; simulated telemetry is never presented as real.
- Each Vercel Function instance has its own SQLite file under `/tmp`. Data is recreated on a cold start and is not shared or durable.
- Socket.IO may connect while a Function instance is warm, but there is no sticky-session guarantee. REST polling still refreshes every page.
- Changing mode to **Live** shows an empty or limited state because local collection and background workers are disabled; no real host is monitored.

For a durable deployment with real agents, use the Render + MongoDB Atlas topology below.

---

## 1. Production topology (optional, not deployed)

| Component | Platform | Artifact |
| --- | --- | --- |
| Frontend (static SPA) | Vercel | `frontend/`, `frontend/vercel.json` |
| API + Socket.IO | Render Web Service (Python) | `render.yaml`, `backend/wsgi.py` |
| Database | MongoDB Atlas (preferred) | `MONGO_URI` |
| Telemetry agents | Remote hosts | `agent/cloudpulse_agent.py` |

This is the durable production path; it is **not** the public demo described above. The frontend is served from a different origin than the API, so CORS and Socket.IO origins must be configured explicitly. The API must run as **one process** because schedulers and Socket.IO state are in-process.

---

## 2. MongoDB Atlas

1. Create a free (M0) cluster in the region closest to the Render service.
2. Create a database user with a long, unique password. Do **not** reuse the seeded application password.
3. Add a network access rule. For a quick evaluation, `0.0.0.0/0` works; for production, restrict it to Render's outbound addresses where possible. Render's egress addresses can change on some plans, so verify current guidance.
4. Copy the driver connection string:

```text
mongodb+srv://cloudpulse:<password>@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority
```

5. URL-encode special characters in the password.
6. CloudPulse uses database `cloudpulse` by default; collections are created automatically.

If Atlas is unreachable, the backend logs a warning and falls back to SQLite. On Render, that SQLite file lives on the ephemeral filesystem and **will be lost on restart or redeploy**. Always configure Atlas for a persistent deployment.

---

## 3. Backend on Render

### Option A — Blueprint

1. Push this repository to GitHub/GitLab.
2. In Render, choose **New → Blueprint**.
3. Select the repository and point the Blueprint path at `cloudpulse/render.yaml` if your Render plan/UI supports a subdirectory Blueprint. The Blueprint spec normally expects `render.yaml` at the repository root; if the dashboard cannot select a path, use Option B or copy the file to the repository root in a dedicated deployment branch.
4. Set the unsynced environment variables when prompted:

| Variable | Required | Value |
| --- | --- | --- |
| `MONGO_URI` | yes (for persistence) | Atlas connection string |
| `MONGO_DB` | no | `cloudpulse` |
| `ALLOWED_ORIGINS` | yes | `https://your-app.vercel.app` (comma-separate additional origins) |
| `SEED_ADMIN_EMAIL` | yes | Your administrator email |
| `SEED_ADMIN_PASSWORD` | yes | Strong unique password |
| `SECRET_KEY` | auto | Generated by the Blueprint |
| `AGENT_ENROLLMENT_TOKEN` | auto | Generated by the Blueprint |
| `APP_ENV` | set by file | `production` |
| `ENABLE_LOCAL_COLLECTOR` | set by file | `false` (the container is not a monitored host) |
| `ENABLE_BACKGROUND_WORKERS` | set by file | `true` |

5. Deploy. The start command is:

```bash
gunicorn --workers 1 --threads 8 --timeout 120 --bind 0.0.0.0:$PORT wsgi:app
```

6. Verify `https://<service>.onrender.com/api/health` returns `200` with `"status": "ok"`.

### Option B — Manual Web Service

- **Root directory:** `cloudpulse/backend`
- **Runtime:** Python 3.12
- **Build command:** `pip install -r requirements.txt`
- **Start command:** `gunicorn --workers 1 --threads 8 --timeout 120 --bind 0.0.0.0:$PORT wsgi:app`
- **Health check path:** `/api/health`
- Add the same environment variables listed above.

### Important Render notes

- **Do not raise `--workers` above 1.** Multiple workers duplicate the telemetry scheduler, anomaly scheduler, cleanup jobs and Socket.IO rooms.
- The generated `SECRET_KEY` must remain stable; changing it invalidates all sessions.
- Free instances sleep after inactivity. The first request after sleep is slow, and WebSocket clients reconnect automatically.
- `python-socketio` runs in threading mode with `simple-websocket`. Stick to the provided start command and a platform that supports WebSockets.
- Set `SEED_ADMIN_PASSWORD` only for first boot. Changing it later does not reset an existing account's password; use the in-app password change instead.
- The backend writes logs and the dev secret under `DATA_DIR`. On Render, set `DATA_DIR=/tmp/cloudpulse` if the default path is not writable, accepting that it is ephemeral.

---

## 4. Frontend on Vercel

1. Import the repository in Vercel.
2. Configure the project:
   - **Root Directory:** `cloudpulse/frontend`
   - **Framework Preset:** Vite
   - **Build Command:** `npm run build`
   - **Output Directory:** `dist`
3. Add environment variables for **Production** (and Preview if desired):

| Variable | Value |
| --- | --- |
| `VITE_API_URL` | `https://<service>.onrender.com/api` |
| `VITE_SOCKET_URL` | `https://<service>.onrender.com` |

4. Deploy. `frontend/vercel.json` supplies the SPA rewrite, immutable asset caching and basic security headers.
5. Add the resulting Vercel origin(s) to the backend `ALLOWED_ORIGINS` and redeploy the API.

### CORS and Socket.IO

- Origins must match exactly (scheme + host, no trailing slash). Add the custom domain and any preview domains you actually use.
- `VITE_API_URL` must include `/api`. The client normalizes a missing suffix, but being explicit avoids mistakes.
- Socket.IO connects to `VITE_SOCKET_URL`; leave it unset only when the API is same-origin (local dev proxy).
- If the browser console reports CORS or WebSocket handshake failures, fix the origin list before changing application code.

### SPA routing

`vercel.json` rewrites non-API paths to `index.html`. Deep links such as `/infrastructure` therefore load correctly. Unknown client routes render the in-app 404 page.

---

## 5. First boot and verification

After the API is healthy and the frontend is deployed:

1. Sign in with the configured `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`.
2. Confirm the top bar shows **Demo data** and the Services page reports the configured backend. On the Vercel demo this is **SQLite local fallback**; on Render with Atlas it should be **MongoDB Atlas**.
3. Confirm demo charts, alerts and anomalies load.
4. For the durable Render deployment, switch to **Live** mode and register a target from Infrastructure.
5. Run the one-time agent command on a real host.
6. Confirm frames arrive on Live Monitoring and alerts evaluate.
7. Download a PDF and a CSV from Reports.
8. Sign out. On a single-process Render deployment verify the token is revoked; on the Vercel demo revocation is instance-local and best-effort.

### Health checks

```bash
curl -i https://<service>.onrender.com/api/health
```

Expected: HTTP 200 and a JSON body containing `"status": "ok"`, `"database"` and version details.

### Authenticated API check

```bash
TOKEN=$(curl -s -X POST https://<service>.onrender.com/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"<password>"}' \
  | python -c "import json,sys; print(json.load(sys.stdin)['token'])")

curl -s https://<service>.onrender.com/api/dashboard/overview \
  -H "Authorization: Bearer $TOKEN"
```

### Agent check

```bash
python3 agent/cloudpulse_agent.py \
  --url https://<service>.onrender.com \
  --key <one-time-agent-key> \
  --interval 5
```

Verify a heartbeat in Infrastructure and frames on Live Monitoring.

---

## 6. Production hardening checklist

- [ ] `APP_ENV=production`
- [ ] Unique `SECRET_KEY` (never commit it)
- [ ] Strong seeded admin password, changed after first login
- [ ] Dedicated Atlas user with least privilege
- [ ] Atlas network access restricted where feasible
- [ ] Exact `ALLOWED_ORIGINS`; no wildcard
- [ ] TLS enforced at both platforms
- [ ] Single API worker
- [ ] `ENABLE_LOCAL_COLLECTOR=false` on hosted API
- [ ] Uptime/error monitoring and log retention configured
- [ ] Backup strategy for Atlas
- [ ] Review retention and threshold policy
- [ ] Rotate agent keys if a host is decommissioned
- [ ] Confirm no demo data is presented as production telemetry

---

## 7. Known deployment limitations

### Current Vercel demo

- **Ephemeral, per-instance data.** SQLite lives in `/tmp`; each Function instance seeds its own copy. Data resets on cold start, writes are not shared, and two requests can see different snapshots.
- **No durable auth/session state.** The seeded admin ID is deterministic so tokens work across instances, but logout revocation, password changes and user management are instance-local.
- **No real telemetry.** Background workers and the local collector are disabled. The eight targets are simulated and labelled **Demo data**; switching to Live does not monitor a real host.
- **Best-effort Socket.IO.** The demo may connect while an instance is warm, but Vercel Functions do not guarantee persistent connections or sticky sessions. REST polling is the reliable data path.
- **Demo credentials are public by design.** The login page exposes the seeded admin credentials for evaluation. Do not reuse this deployment for real data or keep the default password on a durable deployment.
- **No durable report history.** PDF/CSV generation works against the current instance's demo data, but the report ledger is not durable.
- **Bundle size.** The Python function is close to Vercel's function size limit because scikit-learn/numpy are included; adding large dependencies may break the build.

### Production topology (Render + Atlas)

- No Redis, Celery or external scheduler: background work is tied to the single API process.
- Render free instances sleep; Socket.IO reconnects but scheduled work pauses while asleep.
- Uploaded files and generated PDFs are not persisted; PDFs stream directly to the client.
- Email/SMS/PagerDuty notifications are not implemented.
- Cloud provider APIs (AWS/Azure/GCP/CloudWatch) are not integrated.
- SQLite fallback is not suitable for multi-instance or durable production use.
- The Render/Atlas steps above have **not** been executed in this workspace; only the Vercel demo is verified.
