"""Log query and CSV export endpoints."""

import csv
import logging
import re
import time
from datetime import datetime
from io import StringIO
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, Query, Response
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from util.db import get_db, SessionLocal
from util.time_utils import normalize_window

router = APIRouter()
logger = logging.getLogger(__name__)

# Pagination limits
LOG_DEFAULT_LIMIT = 100
LOG_MAX_LIMIT = 500

# Time-window defaults (hours)
LOG_DEFAULT_WINDOW_HOURS = 1
LOG_MAX_WINDOW_HOURS = 48

# Export safety cap
EXPORT_MAX_ROWS = 100_000

# Slow-query threshold
SLOW_QUERY_MS = 1_000


class LogRecord(BaseModel):
    """A single log entry returned by the API."""

    id: int
    ts: datetime
    server_id: Optional[str] = None
    container_id: Optional[str] = None
    container_name: Optional[str] = None
    image: Optional[str] = None
    level: Optional[str] = None
    stream: Optional[str] = None
    message: str
    extra: Optional[Dict[str, Any]] = None
    created_at: Optional[datetime] = None


class LogPage(BaseModel):
    """Paginated log response."""

    items: List[LogRecord]
    total: int
    page: int
    page_size: int


def _fmt(dt: datetime) -> str:
    """Format a datetime as a compact timestamp string for filenames."""
    return dt.strftime("%Y%m%dT%H%M%S")


def _sanitize_name(name: str) -> str:
    """Replace characters that are unsafe in filenames with underscores."""
    return re.sub(r"[^A-Za-z0-9_.-]", "_", name or "all")


@router.get("/logs", response_model=LogPage)
def list_logs(
    response: Response,
    db: Session = Depends(get_db),
    server_id: Optional[str] = Query(None),
    container_name: Optional[str] = Query(None),
    level: Optional[str] = Query(None),
    stream: Optional[str] = Query(None),
    image: Optional[str] = Query(None),
    since: Optional[datetime] = Query(None),
    until: Optional[datetime] = Query(None),
    search: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    limit: int = Query(LOG_DEFAULT_LIMIT, ge=1, le=LOG_MAX_LIMIT),
    with_count: bool = Query(True),
):
    """Return a paginated page of log records.

    Default window is the last hour; maximum window is 48 hours.
    Pass ``with_count=false`` to skip the COUNT query on large data sets.
    """
    since, until = normalize_window(
        since, until,
        default_hours=LOG_DEFAULT_WINDOW_HOURS,
        max_hours=LOG_MAX_WINDOW_HOURS,
    )

    where = "WHERE ts >= :since AND ts <= :until"
    params: Dict[str, Any] = {
        "since": since,
        "until": until,
    }

    if server_id:
        where += " AND server_id = :server_id"
        params["server_id"] = server_id
    if container_name:
        where += " AND container_name = :container_name"
        params["container_name"] = container_name
    if level:
        where += " AND level = :level"
        params["level"] = level
    if stream:
        where += " AND stream = :stream"
        params["stream"] = stream
    if image:
        where += " AND image = :image"
        params["image"] = image
    if search:
        where += " AND message ILIKE :search"
        params["search"] = f"%{search}%"

    t0 = time.perf_counter()
    if with_count:
        count_sql = f"SELECT COUNT(*) FROM container_logs {where}"
        total = db.execute(text(count_sql), params).scalar_one()
    else:
        total = -1

    offset = (page - 1) * limit
    data_sql = f"""
        SELECT
            id,
            ts,
            server_id,
            container_id,
            container_name,
            image,
            level,
            stream,
            message,
            extra,
            created_at
        FROM container_logs
        {where}
        ORDER BY ts DESC
        LIMIT :limit OFFSET :offset
    """
    data_params = dict(params)
    data_params["limit"] = limit
    data_params["offset"] = offset

    rows = db.execute(text(data_sql), data_params).mappings().all()
    items = [LogRecord(**row) for row in rows]

    elapsed_ms = (time.perf_counter() - t0) * 1000
    if elapsed_ms > SLOW_QUERY_MS:
        logger.warning(
            "slow query | endpoint=/v1/logs | server_id=%s container_name=%s "
            "since=%s until=%s search=%s limit=%d page=%d | duration_ms=%.0f",
            server_id, container_name, since, until, search, limit, page, elapsed_ms,
        )

    if with_count and total >= 0:
        response.headers["X-Total-Count"] = str(total)

    return LogPage(
        items=items,
        total=total,
        page=page,
        page_size=limit,
    )


@router.get("/logs/export")
def export_logs(
    server_id: Optional[str] = Query(None),
    container_name: Optional[str] = Query(None),
    level: Optional[str] = Query(None),
    stream: Optional[str] = Query(None),
    image: Optional[str] = Query(None),
    since: Optional[datetime] = Query(None, description="Start time (defaults to last hour)"),
    until: Optional[datetime] = Query(None, description="End time (defaults to now)"),
    search: Optional[str] = Query(None),
):
    """Stream matching log records as a UTF-8 CSV file.

    Capped at ``EXPORT_MAX_ROWS`` rows. The session is managed inside the
    streaming generator so the DB cursor stays open for the full response
    duration and is closed on completion or client disconnect.
    """
    since, until = normalize_window(
        since, until,
        default_hours=LOG_DEFAULT_WINDOW_HOURS,
        max_hours=LOG_MAX_WINDOW_HOURS,
    )

    where = "WHERE ts >= :since AND ts <= :until"
    params: Dict[str, Any] = {
        "since": since,
        "until": until,
        "export_limit": EXPORT_MAX_ROWS,
    }

    if server_id:
        where += " AND server_id = :server_id"
        params["server_id"] = server_id
    if container_name:
        where += " AND container_name = :container_name"
        params["container_name"] = container_name
    if level:
        where += " AND level = :level"
        params["level"] = level
    if stream:
        where += " AND stream = :stream"
        params["stream"] = stream
    if image:
        where += " AND image = :image"
        params["image"] = image
    if search:
        where += " AND message ILIKE :search"
        params["search"] = f"%{search}%"

    sql = f"""
        SELECT
            id,
            ts,
            server_id,
            container_name,
            image,
            level,
            stream,
            message
        FROM container_logs
        {where}
        ORDER BY ts ASC
        LIMIT :export_limit
    """

    def generate():
        """Yield CSV rows one at a time using a dedicated DB session.

        The session is owned by this generator so it stays alive for the
        entire streaming response.  A try/finally block ensures the cursor
        and session are closed even if the client disconnects mid-stream.
        """
        db = SessionLocal()
        result = None
        try:
            buffer = StringIO()
            writer = csv.writer(buffer)

            # UTF-8 BOM for Excel compatibility
            buffer.write("\ufeff")
            writer.writerow(["id", "ts", "server_id", "container_name", "image", "level", "stream", "message"])
            yield buffer.getvalue()
            buffer.seek(0)
            buffer.truncate(0)

            result = db.execute(text(sql), params)
            for row in result:
                writer.writerow(
                    [
                        row.id,
                        row.ts.isoformat() if row.ts else "",
                        row.server_id or "",
                        row.container_name or "",
                        row.image or "",
                        row.level or "",
                        row.stream or "",
                        row.message or "",
                    ]
                )
                yield buffer.getvalue()
                buffer.seek(0)
                buffer.truncate(0)
        finally:
            if result is not None:
                result.close()
            db.close()

    safe_server = _sanitize_name(server_id or "all")
    safe_container = _sanitize_name(container_name or "all")
    filename = f"logs_{safe_server}_{safe_container}_{_fmt(since)}_{_fmt(until)}.csv"

    return StreamingResponse(
        generate(),
        media_type="text/csv; charset=utf-8",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "X-Export-Row-Limit": str(EXPORT_MAX_ROWS),
        },
    )
