# log-observability-api

## Project Overview

`log-observability-api` is the read and presentation service in the Log Observability Platform. It exposes REST endpoints, CSV export, and a built-in web UI for logs and container metrics that have already been collected into PostgreSQL.

This repository is intentionally focused on the consumer side of the platform: query, filter, aggregate, and visualize the shared operational data set.

## Role in Platform

Platform flow:

```text
Docker Host -> docker-log-poller -> PostgreSQL -> log-observability-api -> Browser / API Client
```

- This repo owns read/query APIs, dashboard pages, CSV export, and health checks.
- The companion poller repo owns Docker access, polling, normalization, and database writes.
- Both repos stay independent, but they share platform naming, section structure, and database terminology.

## Key Features

- FastAPI endpoints for logs, server inventory, container status, and time-series metrics
- CSV export for filtered log searches
- Built-in web UI for dashboard, log browsing, and per-container status views
- Query window and pagination limits to protect the database
- Startup health validation against PostgreSQL
- Structured application logging with slow-query warnings

## Architecture

```text
+--------------------+      writes shared tables      +---------------------------+
| docker-log-poller  | -----------------------------> | PostgreSQL                |
| collection service |                                | - container_logs          |
+--------------------+                                | - container_status        |
                                                      +-------------+-------------+
                                                                    |
                                                                    | read queries
                                                                    v
                                                      +---------------------------+
                                                      | log-observability-api     |
                                                      | FastAPI + Web UI          |
                                                      +-------------+-------------+
                                                                    |
                                         +--------------------------+--------------------------+
                                         |                                                     |
                                         v                                                     v
                               Browser dashboard                                      API / CSV clients
```

Data ownership in this repo:

- Query `container_logs` with pagination, time windows, and text filters
- Query `container_status` for latest status and historical metrics
- Render dashboard pages on top of the same shared database
- Surface application and slow-query logs for operational review

## Directory Structure

```text
log-observability-api/
|-- api/
|   `-- v1/
|       |-- logs.py         # Log query and CSV export endpoints
|       `-- containers.py   # Server, container, status, and metrics endpoints
|-- util/
|   |-- db.py               # SQLAlchemy engine and DB session helpers
|   `-- time_utils.py       # Shared query window validation
|-- web/
|   |-- routes.py           # HTML page routes
|   `-- templates/          # Jinja templates and static assets
|-- tests/                  # Smoke tests and fixtures
|-- config.py               # Environment validation and database URL builder
|-- main.py                 # FastAPI app factory and logging setup
|-- Dockerfile              # Runtime image definition
|-- docker-compose.yml      # Run a prebuilt image
|-- .env.example            # Public environment template
`-- requirements*.txt       # Runtime and dev dependencies
```

## Environment Variables

Copy `.env.example` to `.env` and fill in the values for the API service.

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `LOG_DB_HOST` | Yes | - | PostgreSQL host |
| `LOG_DB_PORT` | No | `5432` | PostgreSQL port |
| `LOG_DB_USER` | Yes | - | PostgreSQL user |
| `LOG_DB_PASSWORD` | Yes | - | PostgreSQL password |
| `LOG_DB_NAME` | Yes | - | PostgreSQL database name |
| `APP_PORT` | No | `8810` | Host port mapped to the FastAPI container |
| `IMAGE_REPOSITORY` | No | `log-observability-api` | Image name used by `docker-compose.yml` |
| `IMAGE_TAG` | No | `latest` | Image tag used by `docker-compose.yml` |

## Local Development

1. Create and activate a virtual environment.
2. Install runtime dependencies with `pip install -r requirements.txt`.
3. Copy `.env.example` to `.env` and provide PostgreSQL connection values.
4. Run `uvicorn main:app --host 0.0.0.0 --port 8810 --reload`.
5. Open `/docs`, `/dashboard`, `/logs`, or `/status`.

Example:

```bash
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env
uvicorn main:app --host 0.0.0.0 --port 8810 --reload
```

## Docker / Deployment

Run the prebuilt image with Docker Compose:

```bash
docker compose up -d
```

Operational notes:

- The service does not collect logs itself; it requires the shared PostgreSQL tables to already be populated.
- The container exposes port `8810` internally and uses `APP_PORT` for host mapping.
- `deploy.sh` performs a simple `down -> pull -> up -d` deployment cycle for environments that already provide `.env`.

## Related Repository

Companion repo: `docker-log-poller`

- `docker-log-poller` is deployed on Docker hosts and writes into PostgreSQL.
- `log-observability-api` reads from that database and serves users or automation.
- Each repo is documented to stand alone, but together they form the Log Observability Platform.

## Future Improvements / Notes

- Logging: startup/shutdown events and slow queries are logged to stdout; route handlers warn when queries exceed one second.
- Commit convention: use Conventional Commits such as `feat(api): ...`, `fix(api): ...`, `refactor(shared): ...`, and `docs(readme): ...`.
- Public repo readiness: keep `.env` untracked, document only placeholders in `.env.example`, and publish under MIT.
- Naming note: publish this repository under the repo name `log-observability-api` even if your local folder name differs.
