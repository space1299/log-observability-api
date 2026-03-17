# LogStorageAPI

A lightweight FastAPI service that exposes Docker container logs and runtime metrics collected by an external agent. It provides a paginated REST API, a CSV export endpoint, and a built-in web dashboard.

---

## Architecture

This service is the **storage and retrieval layer** in a broader container-monitoring pipeline. An external log-collection agent (separate repository) reads logs and metrics from Docker hosts and writes them to PostgreSQL. LogStorageAPI sits in front of that database.

```
Docker Hosts
    │
    │  log collection agent (separate repo)
    ▼
PostgreSQL Database
    ├── container_logs
    └── container_status
              │
              ▼
   LogStorageAPI  ◄──── REST API clients / curl / scripts
              │
              ▼
     Web Dashboard (port 8810)
     ├── /dashboard  — container overview grid
     ├── /logs       — log viewer with pagination & CSV export
     └── /status     — per-container metrics and charts
```

---

## Prerequisites

| Tool | Version |
|---|---|
| Python | 3.12+ |
| PostgreSQL | 14+ |
| Docker + Docker Compose | v2+ |

---

## Quick Start

```bash
# 1. Clone and configure
git clone https://github.com/yourname/LogStorageAPI.git
cd LogStorageAPI
cp .env.example .env
# Edit .env — fill in your PostgreSQL connection details

# 2. Run with Docker Compose
docker compose up -d

# 3. Open the dashboard
open http://localhost:8810

# 4. Browse the interactive API docs
open http://localhost:8810/docs
```

### Run from source (development)

```bash
python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt

# Export env vars or point to a .env file loaded by your shell
export LOG_DB_HOST=localhost
export LOG_DB_USER=youruser
export LOG_DB_PASSWORD=yourpassword
export LOG_DB_NAME=ologs

uvicorn main:app --host 0.0.0.0 --port 8810 --reload
```

---

## Environment Variables

Copy `.env.example` to `.env` and fill in the values.
**Never commit `.env` — it is listed in `.gitignore`.**

| Variable | Required | Default | Description |
|---|---|---|---|
| `LOG_DB_HOST` | **Yes** | — | PostgreSQL hostname or IP |
| `LOG_DB_PORT` | No | `5432` | PostgreSQL port |
| `LOG_DB_USER` | **Yes** | — | Database username |
| `LOG_DB_PASSWORD` | **Yes** | — | Database password |
| `LOG_DB_NAME` | **Yes** | — | Database name |
| `REGISTRY_URL` | No | `logstorageapi` | Docker image registry path (used by docker-compose) |
| `IMAGE_TAG` | No | `latest` | Docker image tag |
| `APP_PORT` | No | `8810` | Host port to expose |

---

## API Reference

Interactive docs are available at `/docs` (Swagger UI) and `/redoc` when the service is running.

### Logs

| Method | Path | Description |
|---|---|---|
| `GET` | `/v1/logs` | Paginated log query |
| `GET` | `/v1/logs/export` | Stream all matching logs as CSV |

**Key query parameters for `/v1/logs`:**

| Parameter | Default | Max | Description |
|---|---|---|---|
| `page` | `1` | — | Page number (1-indexed) |
| `limit` | `100` | `500` | Rows per page |
| `since` | last 1 hour | — | ISO 8601 start time |
| `until` | now | — | ISO 8601 end time |
| `server_id` | — | — | Filter by server |
| `container_name` | — | — | Filter by container |
| `level` | — | — | Filter by log level |
| `stream` | — | — | Filter by stream (`stdout`/`stderr`) |
| `search` | — | — | Case-insensitive message substring |
| `with_count` | `true` | — | Set `false` to skip COUNT query |

> Maximum query window: **48 hours**. Export is capped at **100 000 rows**.

### Containers & Metrics

| Method | Path | Description |
|---|---|---|
| `GET` | `/v1/servers` | List all servers |
| `GET` | `/v1/containers` | List all (server, container) pairs |
| `GET` | `/v1/servers/{server_id}/containers` | Latest status for all containers on a server |
| `GET` | `/v1/status` | Container status records (filterable) |
| `GET` | `/v1/containers/{server_id}/{name}/metrics` | Time-series metrics |

**Metric types** (`metric` parameter): `cpu_usage`, `mem_usage`, `mem_usage_bytes`, `net_bytes`

**Limit defaults:**

| Endpoint | Default | Max |
|---|---|---|
| `/v1/status` | `50` | `200` |
| `/v1/…/metrics` | `300` | `1 000` |

### Health

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Liveness probe — returns `{"status": "ok"}` |

---

## Database Schema

The service queries two tables populated by the external collection agent.

### `container_logs`

| Column | Type | Description |
|---|---|---|
| `id` | `BIGSERIAL` | Primary key |
| `ts` | `TIMESTAMPTZ` | Log timestamp |
| `server_id` | `TEXT` | Source server identifier |
| `container_id` | `TEXT` | Docker container ID |
| `container_name` | `TEXT` | Docker container name |
| `image` | `TEXT` | Docker image name |
| `level` | `TEXT` | Log level (INFO, ERROR, …) |
| `stream` | `TEXT` | `stdout` or `stderr` |
| `message` | `TEXT` | Log message body |
| `extra` | `JSONB` | Additional structured fields |
| `created_at` | `TIMESTAMPTZ` | Row insertion time |

### `container_status`

| Column | Type | Description |
|---|---|---|
| `ts` | `TIMESTAMPTZ` | Snapshot timestamp |
| `server_id` | `TEXT` | Source server identifier |
| `container_id` | `TEXT` | Docker container ID |
| `container_name` | `TEXT` | Docker container name |
| `image` | `TEXT` | Docker image name |
| `created_at` | `TIMESTAMPTZ` | Container creation time |
| `uptime_sec` | `BIGINT` | Uptime in seconds |
| `status` | `TEXT` | Container status string |
| `cpu_usage` | `FLOAT` | CPU usage % |
| `mem_usage` | `FLOAT` | Memory usage % |
| `mem_usage_bytes` | `BIGINT` | Memory usage in bytes |
| `net_rx_bytes` | `BIGINT` | Network received bytes |
| `net_tx_bytes` | `BIGINT` | Network transmitted bytes |

---

## CI/CD Pipeline

The Gitea Actions workflow (`.gitea/workflows/ci.yml`) triggers on every push to `master`:

1. **Build** — `docker build` produces two image tags: `latest` and a date stamp (`YYYYmmdd-HHMM`).
2. **Push** — both tags are pushed to the configured private registry.
3. **Deploy** — `docker-compose.yml` and `deploy.sh` are copied to the remote server via SCP; `deploy.sh` runs `docker compose pull && docker compose up -d`.

All sensitive values (registry URL, SSH host, user, key, app path) are stored in **Gitea repository secrets** — nothing is hardcoded in the workflow file.

---

## Development

### Running tests

```bash
pip install -r requirements-dev.txt
pytest tests/ -v
```

The test suite uses a mocked database connection — no live PostgreSQL required.

### Project structure

```
LogStorageAPI/
├── main.py                  # App factory, logging config, lifespan
├── config.py                # Environment-variable validation
├── requirements.txt         # Runtime dependencies
├── requirements-dev.txt     # Dev/test dependencies
├── Dockerfile               # Python 3.12-slim image
├── docker-compose.yml       # Single-service Compose definition
├── deploy.sh                # Pull-and-restart deployment script
├── .env.example             # Template for required env vars
│
├── api/v1/
│   ├── logs.py              # GET /v1/logs, GET /v1/logs/export
│   └── containers.py        # GET /v1/status, /servers, /containers, /metrics
│
├── util/
│   ├── db.py                # SQLAlchemy engine + session factory
│   └── time_utils.py        # Shared query-window validation
│
├── web/
│   ├── routes.py            # HTML page routes
│   └── templates/           # Jinja2 templates + static assets
│
└── tests/
    ├── conftest.py          # Pytest fixtures (mocked DB)
    └── test_smoke.py        # Smoke tests
```

---

## Performance Notes

- All queries use **SQL-level `LIMIT`/`OFFSET`** — the application never fetches then slices.
- The default log query window is **1 hour**; the maximum is 48 hours.
- The `/v1/logs/export` endpoint streams rows one at a time using a cursor; the session is owned by the generator and closed in a `try/finally` block.
- Queries exceeding **1 second** are logged as `WARNING` with endpoint, parameters, and duration.
- The SQLAlchemy engine enforces a **30-second statement timeout** at the PostgreSQL level.

---

## License

MIT — see [LICENSE](LICENSE).
