# CloudPulse API reference

Base URL locally: `http://127.0.0.1:5000/api`

Interactive browser documentation: `GET /api/docs`  
Machine-readable description: `GET /api/openapi.json`

All request and response bodies are JSON unless noted. API responses set `Cache-Control: no-store`.

---

## Authentication

Protected endpoints require a bearer token:

```http
Authorization: Bearer <jwt>
```

Obtain a token with `POST /api/auth/login` or `POST /api/auth/register`. Tokens expire after `JWT_EXPIRES_MINUTES` (default 720) and are revoked on logout or password change.

### Roles

| Role | Capabilities |
| --- | --- |
| `admin` | Full access: targets, agent keys, alert lifecycle, settings/mode, anomaly scans, user listing, reports. |
| `viewer` | Read dashboards, inventory, telemetry, alerts, anomalies, analytics, reports and services. No mutations. |

The first account created in an empty database becomes an admin. Self-registration afterwards creates viewers.

### Error format

```json
{
  "error": {
    "message": "A human-readable explanation.",
    "code": "validation_error",
    "field": "email"
  }
}
```

Common statuses: `400` validation, `401` unauthenticated/invalid token, `403` role or source violation, `404` missing resource, `409` conflict, `429` login rate limit.

Login attempts are rate-limited in memory: 10 attempts per IP/email per 5 minutes.

---

## Health and metadata

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| GET | `/health` | Public | Liveness, version, mode, database backend, worker state. `503` if the database is disconnected. |
| GET | `/meta` | Public | Product name, version and documentation links. |
| GET | `/openapi.json` | Public | Generated OpenAPI-style path map. |
| GET | `/docs` | Public | HTML API documentation page. |

`GET /api/health` example:

```json
{
  "status": "ok",
  "service": "cloudpulse-api",
  "version": "1.0.0",
  "environment": "development",
  "mode": "demo",
  "data_source": "simulated",
  "database": { "backend": "sqlite", "connected": true, "detail": "…" },
  "workers": { "running": true, "last_error": null }
}
```

---

## Auth

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| POST | `/auth/register` | Public | Create an account. Body: `name`, `email`, `password` (8–128 chars). Returns `201` with token and user. |
| POST | `/auth/login` | Public | Body: `email`, `password`. Returns `token`, `expires_at`, `user`. |
| POST | `/auth/logout` | User | Revokes the current token. |
| GET | `/auth/me` | User | Current user. |
| PUT | `/auth/profile` | User | Update `name` and/or `email`. |
| POST | `/auth/password` | User | Body: `current_password`, `new_password`. Returns a fresh token and revokes prior tokens. |
| GET | `/auth/users` | Admin | List up to 200 users. |

Login request:

```bash
curl -X POST http://127.0.0.1:5000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@cloudpulse.dev","password":"Admin@12345"}'
```

Response:

```json
{
  "token": "eyJ…",
  "expires_at": "2026-11-21T18:00:00+00:00",
  "user": { "id": "user_…", "name": "Alex Morgan", "email": "admin@cloudpulse.dev", "role": "admin" }
}
```

---

## Dashboard

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| GET | `/dashboard/overview` | User | KPIs, fleet trend, health distribution, active alerts, target matrix, recent activity and mode metadata. |

Query parameters:

| Parameter | Values | Default |
| --- | --- | --- |
| `range` | `15m`, `1h`, `6h`, `24h`, `7d`, `30d`, `custom` | `24h` |
| `from`, `to` | ISO/date strings when `range=custom` | — |
| `source` | `simulated`, `live`, `all` | current mode |

---

## Infrastructure targets

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| GET | `/servers` | User | Paginated target list. |
| POST | `/servers` | Admin | Register a live target and receive a one-time agent key. |
| POST | `/servers/register` | Agent enrollment token | Alternative remote self-enrollment. |
| GET | `/servers/<id>` | User | Target detail, recent metrics, alerts, anomalies, availability. |
| GET | `/servers/<id>/metrics` | User | Historical metrics for one target. |
| POST | `/servers/<id>/check` | User | Recompute heartbeat/health state. |
| PATCH | `/servers/<id>` | Admin | Update mutable target metadata. |
| POST | `/servers/<id>/rotate-key` | Admin | Rotate the agent key; previous key stops immediately. |
| DELETE | `/servers/<id>` | Admin | Delete target and all telemetry/alerts/anomalies. Local target is protected. |

`GET /api/servers` parameters: `page` (default 1), `limit` (max 100), `q`, `status` (`healthy|warning|critical|offline`), `type`, `source` (`simulated|live|all`).

Response includes `items`, `total`, `page`, `limit`, `pages`, `status_counts`, `mode`, `data_source`, `types`.

Create target body:

```json
{
  "name": "prod-api-09",
  "hostname": "prod-api-09.internal",
  "ip_address": "10.0.4.19",
  "os": "Ubuntu 24.04 LTS",
  "resource_type": "Virtual Machine",
  "environment": "production",
  "provider": "Self-managed",
  "region": "eu-central-1a",
  "description": "Customer-facing API",
  "tags": ["web", "critical"],
  "cost_per_hour": 0.042
}
```

Creation is only allowed in live mode. Response contains:

```json
{
  "server": { "id": "srv_…", "name": "prod-api-09" },
  "agent": {
    "key": "cp_live_…",
    "ingest_url": "https://example.com/api/telemetry/ingest",
    "header": "X-Agent-Key",
    "command": "python agent/cloudpulse_agent.py --url … --key …",
    "note": "One-time secret; only a hash is stored."
  },
  "message": "…"
}
```

---

## Telemetry

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| POST | `/telemetry/ingest` | `X-Agent-Key` | Accept one live sample. |
| POST | `/telemetry/heartbeat` | `X-Agent-Key` | Record liveness without a sample. |
| GET | `/telemetry/validate` | `X-Agent-Key` | Validate a key and return the server name and interval hint. |
| GET | `/telemetry/history` | User | Paginated stored telemetry. |
| GET | `/telemetry/latest` | User | Latest sample per target for the current source. |

Ingest body:

```json
{
  "cpu_percent": 43.2,
  "memory_percent": 61.8,
  "disk_percent": 72.4,
  "network_in_bps": 1840000,
  "network_out_bps": 920000,
  "response_time_ms": 18.4,
  "memory_total_mb": 16384,
  "memory_available_mb": 6258,
  "uptime_seconds": 864000,
  "load_average": 1.42
}
```

Required: `cpu_percent`, `memory_percent`, `disk_percent`. Numeric ranges are validated. Ingestion triggers automatic health scoring and threshold alert evaluation.

History parameters: `range` (`15m|1h|6h|24h|7d|30d|custom`), `from`, `to`, `server_id`, `source`, `page`, `limit`.

---

## Alerts

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| GET | `/alerts` | User | Paginated alerts with summary. |
| GET | `/alerts/<id>` | User | One alert. |
| POST | `/alerts/<id>/acknowledge` | Admin | Mark acknowledged by the current user. |
| POST | `/alerts/<id>/resolve` | Admin | Resolve; optional body `{"reason": "..."}` (max 500 chars). |
| GET | `/alerts/summary/current` | User | Current alert counters and categories. |
| GET | `/alerts/categories/list` | User | Known alert categories. |

List parameters: `status` (`active|acknowledged|resolved`), `severity` (`warning|critical`), `category`, `server_id`, `source`, `page`, `limit`.

Alerts are deduplicated per server + category while active. A warning breach can escalate the existing alert to critical rather than creating a duplicate.

---

## Analytics

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| GET | `/analytics` | User | Aggregated trends, daily profile, comparisons, availability, top consumers and cost estimates. |

Parameters: `range` (`24h|7d|30d|custom`), `from`, `to`, `server_id`, `source`.

The response includes `range`, `totals`, `series`, `daily`, `availability`, `comparisons`, `top_consumers`, `costs` (with `note`) and `notes` explaining data provenance.

---

## Anomalies

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| GET | `/anomalies` | User | Anomaly list, summary, latest run, run history and filterable targets. |
| POST | `/anomalies/detect` | Admin | Run an Isolation Forest pass immediately. |
| GET | `/anomalies/runs` | User | Recent detection runs. |
| GET | `/anomalies/timeline` | User | Daily counts split by severity. |

Parameters: `range` (`24h|7d|30d|custom`), `from`, `to`, `severity`, `server_id`, `source`.

Detection requires at least 40 telemetry points per target. Results are deduplicated by server/metric/timestamp and emitted as `anomalies:updated`.

---

## Reports

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| GET | `/reports` | User | Report ledger (last 30 generated PDFs). |
| GET | `/reports/summary` | User | JSON preview of a daily or weekly report. |
| GET | `/reports/pdf` | User | Stream a branded PDF and record its metadata. |
| GET | `/reports/export` | User | Download telemetry CSV. |

Parameters:

- `type`: `daily` (default) or `weekly`
- `date`: anchor date (`YYYY-MM-DD`); defaults to today
- `source`: optional `simulated|live`
- Export: `dataset=telemetry` (only dataset), `range`, `from`, `to`, `server_id`

CSV includes a UTF-8 BOM for spreadsheet compatibility. PDFs are generated on demand and are not stored server-side.

---

## Settings

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| GET | `/settings` | User | Monitoring settings, effective offline threshold and runtime status. |
| PUT | `/settings` | Admin | Update mode, intervals, retention, anomaly toggles and thresholds. |

Update body accepts any subset:

```json
{
  "mode": "live",
  "monitoring_interval_seconds": 5,
  "offline_after_seconds": 30,
  "retention_days": 30,
  "anomaly_detection_enabled": true,
  "auto_resolve_availability": true,
  "thresholds": {
    "cpu": { "warning": 70, "critical": 85 },
    "memory": { "warning": 75, "critical": 90 },
    "disk": { "warning": 85, "critical": 95 },
    "response_time_ms": { "warning": 500, "critical": 1000 },
    "network_mbps": { "warning": 400, "critical": 800 }
  }
}
```

Warning must be below critical. Switching to live starts the local collector when enabled; switching to demo generates a demo tick. Mode changes emit `mode:changed`.

---

## Services

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| GET | `/services` | User | Service inventory with per-item `kind`, `verified`, `status`, database backend and an explicit honesty disclaimer. |

`kind` is one of `actual`, `simulated`, `fallback`, `configuration`, `conceptual`. This endpoint intentionally distinguishes implemented capabilities from planned integrations.

---

## Socket.IO events

Connect with the JWT in the handshake:

```js
import { io } from "socket.io-client";

const socket = io(API_ORIGIN, {
  auth: { token },
  transports: ["websocket", "polling"],
});
```

| Event | Direction | Payload |
| --- | --- | --- |
| `telemetry:update` | Server → client | Server identity, metrics, health score, status, timestamp, data source |
| `alert:new` | Server → client | New alert document |
| `alert:updated` | Server → client | Updated alert document |
| `server:created` | Server → client | Created target |
| `server:updated` | Server → client | Updated target |
| `server:deleted` | Server → client | Deleted target id |
| `anomalies:updated` | Server → client | Detection run summary |
| `mode:changed` | Server → client | Mode, source, actor, timestamp |
| `settings:updated` | Server → client | Changed settings summary |
| `report:created` | Server → client | Report ledger entry |

Transport is Socket.IO with WebSocket preferred and polling fallback. An invalid or missing token causes the handshake to be rejected.

---

## Agent protocol

The standalone agent uses:

1. `GET /api/health` to measure API latency.
2. `POST /api/telemetry/ingest` with `X-Agent-Key` on each interval.
3. `POST /api/telemetry/heartbeat` between samples or when collection is skipped.
4. Optional `GET /api/telemetry/validate` at startup.

Agent source: [`agent/cloudpulse_agent.py`](../agent/cloudpulse_agent.py)
