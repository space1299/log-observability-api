"""LogStorageAPI — FastAPI application factory."""

import logging
import logging.config
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text
from sqlalchemy.exc import OperationalError

from api.v1.logs import router as logs_router
from api.v1.containers import router as containers_router
from web.routes import router as web_router

BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "web/templates/static"

# ── Logging configuration ────────────────────────────────────────────────────

LOGGING_CONFIG = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {
        "default": {
            "format": "%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
            "datefmt": "%Y-%m-%dT%H:%M:%S",
        },
    },
    "handlers": {
        "console": {
            "class": "logging.StreamHandler",
            "formatter": "default",
            "stream": "ext://sys.stdout",
        },
    },
    "root": {
        "level": "INFO",
        "handlers": ["console"],
    },
    "loggers": {
        "uvicorn.access": {"level": "INFO"},
        # Suppress SQLAlchemy's per-statement echo; slow-query warnings come
        # from our own handlers in the route modules.
        "sqlalchemy.engine": {"level": "WARNING"},
    },
}

logging.config.dictConfig(LOGGING_CONFIG)
logger = logging.getLogger(__name__)


# ── Lifespan (startup / shutdown) ────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Validate database connectivity before accepting traffic."""
    from util.db import engine
    from config import LOG_DB_HOST, LOG_DB_PORT, LOG_DB_NAME

    logger.info(
        "Starting LogStorageAPI — db_host=%s db_port=%s db_name=%s",
        LOG_DB_HOST, LOG_DB_PORT, LOG_DB_NAME,
    )

    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        logger.info("Database connectivity check passed")
    except OperationalError as exc:
        logger.error("Database is unreachable at startup: %s", exc)
        raise RuntimeError("Cannot connect to the configured database.") from exc

    yield

    logger.info("LogStorageAPI shutting down")


# ── Application factory ───────────────────────────────────────────────────────

def create_app() -> FastAPI:
    """Build and return the configured FastAPI application."""
    app = FastAPI(
        title="Container Log API",
        description=(
            "Query and visualise Docker container logs and runtime metrics "
            "collected by an external agent."
        ),
        version="1.0.0",
        lifespan=lifespan,
    )

    # ── Global exception handler ─────────────────────────────────────────────
    @app.exception_handler(Exception)
    async def global_exception_handler(request: Request, exc: Exception):
        logger.error(
            "Unhandled exception | %s %s | %s: %s",
            request.method, request.url.path,
            type(exc).__name__, exc,
            exc_info=True,
        )
        return JSONResponse(
            status_code=500,
            content={"detail": "An internal server error occurred."},
        )

    # ── Middleware ────────────────────────────────────────────────────────────
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # ── Static files & routers ────────────────────────────────────────────────
    app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

    app.include_router(logs_router, prefix="/v1", tags=["logs"])
    app.include_router(containers_router, prefix="/v1", tags=["containers"])
    app.include_router(web_router, tags=["web"])

    # ── Health check ──────────────────────────────────────────────────────────
    @app.get("/health", tags=["health"], summary="Service liveness probe")
    def health():
        """Return 200 OK when the service is running."""
        return {"status": "ok"}

    return app


app = create_app()
