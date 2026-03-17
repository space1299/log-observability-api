"""Container status and time-series metrics endpoints."""

import logging
import time
from datetime import datetime
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Path, Query
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from util.db import get_db
from util.time_utils import normalize_window

router = APIRouter()
logger = logging.getLogger(__name__)

# Pagination limits
STATUS_MAX_LIMIT = 200
METRIC_DEFAULT_LIMIT = 300
METRIC_MAX_LIMIT = 1_000

# Slow-query threshold
SLOW_QUERY_MS = 1_000

# Metric time-window bounds (hours)
METRIC_DEFAULT_HOURS = 1
METRIC_MAX_HOURS = 48


class ContainerStatus(BaseModel):
    """Latest or historical status record for a container."""

    ts: datetime
    server_id: str
    container_name: str
    container_id: str
    image: Optional[str] = None
    created_at: Optional[datetime] = None
    uptime_sec: Optional[int] = None
    status: Optional[str] = None
    cpu_usage: Optional[float] = None
    mem_usage: Optional[float] = None
    mem_usage_bytes: Optional[int] = None
    net_rx_bytes: Optional[int] = None
    net_tx_bytes: Optional[int] = None


class MetricPoint(BaseModel):
    """A single scalar time-series point."""

    ts: datetime
    value: Optional[float] = None


class NetMetricPoint(BaseModel):
    """A network metric point with separate RX and TX values."""

    ts: datetime
    rx: Optional[int] = None
    tx: Optional[int] = None


class MetricSeries(BaseModel):
    """Time-series metric response; point shape varies by metric type."""

    metric: str
    server_id: str
    container_name: str
    points: List[Dict[str, Any]]


class ContainerInfo(BaseModel):
    """Lightweight container identifier."""

    server_id: str
    container_name: str


class ServerInfo(BaseModel):
    """Server identifier."""

    server_id: str


@router.get("/containers", response_model=List[ContainerInfo])
def list_containers(db: Session = Depends(get_db)):
    """Return the distinct (server_id, container_name) pairs seen in the status table."""
    sql = """
        SELECT DISTINCT
            COALESCE(server_id, '') AS server_id,
            COALESCE(container_name, '') AS container_name
        FROM container_status
        WHERE container_name IS NOT NULL
        ORDER BY server_id ASC, container_name ASC
    """
    rows = db.execute(text(sql)).mappings().all()
    return [ContainerInfo(**row) for row in rows]


@router.get("/status", response_model=List[ContainerStatus])
def list_status(
    db: Session = Depends(get_db),
    server_id: Optional[str] = Query(None, description="Filter by server"),
    container_name: Optional[str] = Query(None, description="Filter by container name"),
    status: Optional[str] = Query(None, description="Filter by status (running/exited/restarting/…)"),
    latest: Optional[int] = Query(0, ge=0, le=1, description="1 = return only the most-recent row per filter"),
    limit: int = Query(50, ge=1, le=STATUS_MAX_LIMIT, description="Maximum rows to return when latest=0"),
):
    """Return container status records.

    Set ``latest=1`` to get only the single most-recent record matching
    the filters.  Set ``latest=0`` (default) to get up to ``limit`` recent
    records ordered newest-first.
    """
    where = "WHERE 1=1"
    params: Dict[str, Any] = {}

    if server_id:
        where += " AND server_id = :server_id"
        params["server_id"] = server_id
    if container_name:
        where += " AND container_name = :container_name"
        params["container_name"] = container_name
    if status:
        where += " AND status = :status"
        params["status"] = status

    if latest:
        sql = f"""
            SELECT
                ts,
                server_id,
                container_name,
                container_id,
                image,
                created_at,
                uptime_sec,
                status,
                cpu_usage,
                mem_usage,
                mem_usage_bytes,
                net_rx_bytes,
                net_tx_bytes
            FROM container_status
            {where}
            ORDER BY ts DESC
            LIMIT 1
        """
    else:
        sql = f"""
            SELECT
                ts,
                server_id,
                container_name,
                container_id,
                image,
                created_at,
                uptime_sec,
                status,
                cpu_usage,
                mem_usage,
                mem_usage_bytes,
                net_rx_bytes,
                net_tx_bytes
            FROM container_status
            {where}
            ORDER BY ts DESC
            LIMIT :limit
        """
        params["limit"] = limit

    rows = db.execute(text(sql), params).mappings().all()
    return [ContainerStatus(**row) for row in rows]


@router.get("/servers", response_model=List[ServerInfo])
def list_servers(db: Session = Depends(get_db)):
    """Return the distinct server IDs seen in the status table."""
    sql = """
        SELECT DISTINCT
            server_id
        FROM container_status
        WHERE server_id IS NOT NULL
          AND server_id <> ''
        ORDER BY server_id ASC
    """
    rows = db.execute(text(sql)).mappings().all()
    return [ServerInfo(**row) for row in rows]


@router.get(
    "/servers/{server_id}/containers",
    response_model=List[ContainerStatus],
    summary="Latest status for all containers on a server",
)
def list_latest_containers_for_server(
    server_id: str = Path(..., description="Target server ID"),
    db: Session = Depends(get_db),
):
    """Return the most-recent status row for every container on *server_id*.

    Uses PostgreSQL ``DISTINCT ON`` for an efficient single-pass query.
    """
    sql = """
        SELECT DISTINCT ON (server_id, container_name)
            ts,
            server_id,
            container_name,
            container_id,
            image,
            created_at,
            uptime_sec,
            status,
            cpu_usage,
            mem_usage,
            mem_usage_bytes,
            net_rx_bytes,
            net_tx_bytes
        FROM container_status
        WHERE server_id = :server_id
          AND container_name IS NOT NULL
        ORDER BY server_id, container_name, ts DESC
    """

    rows = db.execute(text(sql), {"server_id": server_id}).mappings().all()
    return [ContainerStatus(**row) for row in rows]

@router.get(
    "/containers/{server_id}/{container_name}/metrics",
    response_model=MetricSeries,
    summary="특정 컨테이너의 시계열 메트릭 조회",
)
def get_container_metrics(
    server_id: str = Path(..., description="대상 서버 ID"),
    container_name: str = Path(..., description="대상 컨테이너 이름"),
    metric: str = Query(
        ...,
        description="조회할 메트릭 (cpu_usage | mem_usage | mem_usage_bytes | net_bytes)",
    ),
    since: Optional[datetime] = Query(
        None,
        description="조회 시작 시간(ISO8601). 없으면 최근 1시간 기준",
    ),
    until: Optional[datetime] = Query(
        None,
        description="조회 끝 시간(ISO8601). 없으면 최근 1시간 기준",
    ),
    limit: int = Query(METRIC_DEFAULT_LIMIT, ge=1, le=METRIC_MAX_LIMIT, description="최대 반환 포인트 수"),
    db: Session = Depends(get_db),
):
    """
    /status.html에서 그래프/시계열 테이블용으로 사용하는 메트릭 API.

    - metric = cpu_usage          → value 컬럼으로 반환
    - metric = mem_usage          → value 컬럼으로 반환
    - metric = mem_usage_bytes    → value 컬럼으로 반환
    - metric = net_bytes          → rx/tx 컬럼으로 반환
    """
    since, until = normalize_window(
        since, until,
        default_hours=METRIC_DEFAULT_HOURS,
        max_hours=METRIC_MAX_HOURS,
    )

    valid_metrics = {"cpu_usage", "mem_usage", "mem_usage_bytes", "net_bytes"}
    if metric not in valid_metrics:
        raise HTTPException(
            status_code=400,
            detail=f"지원하지 않는 metric 입니다. 지원: {', '.join(sorted(valid_metrics))}",
        )

    t0 = time.perf_counter()
    params: Dict[str, Any] = {
        "server_id": server_id,
        "container_name": container_name,
        "since": since,
        "until": until,
        "limit": limit,
    }

    if metric in {"cpu_usage", "mem_usage"}:
        col = metric  # 그대로 사용
        sql = f"""
            SELECT
                ts,
                {col} AS value
            FROM container_status
            WHERE server_id = :server_id
              AND container_name = :container_name
              AND ts >= :since
              AND ts <= :until
              AND {col} IS NOT NULL
            ORDER BY ts ASC
            LIMIT :limit
        """
        rows = db.execute(text(sql), params).mappings().all()
        points = [MetricPoint(**row).dict() for row in rows]

    elif metric == "mem_usage_bytes":
        col = "mem_usage_bytes"
        sql = f"""
            SELECT
                ts,
                {col} AS value
            FROM container_status
            WHERE server_id = :server_id
              AND container_name = :container_name
              AND ts >= :since
              AND ts <= :until
              AND {col} IS NOT NULL
            ORDER BY ts ASC
            LIMIT :limit
        """
        rows = db.execute(text(sql), params).mappings().all()
        points = [MetricPoint(**row).dict() for row in rows]

    elif metric == "net_bytes":
        sql = """
            SELECT
                ts,
                net_rx_bytes AS rx,
                net_tx_bytes AS tx
            FROM container_status
            WHERE server_id = :server_id
              AND container_name = :container_name
              AND ts >= :since
              AND ts <= :until
              AND (net_rx_bytes IS NOT NULL OR net_tx_bytes IS NOT NULL)
            ORDER BY ts ASC
            LIMIT :limit
        """
        rows = db.execute(text(sql), params).mappings().all()
        points = [NetMetricPoint(**row).dict() for row in rows]

    else:
        raise HTTPException(status_code=400, detail="invalid metric")

    elapsed_ms = (time.perf_counter() - t0) * 1000
    if elapsed_ms > SLOW_QUERY_MS:
        logger.warning(
            "slow query | endpoint=/v1/containers/metrics | server_id=%s container_name=%s "
            "metric=%s since=%s until=%s limit=%d | duration_ms=%.0f",
            server_id, container_name, metric, since, until, limit, elapsed_ms,
        )

    return MetricSeries(
        metric=metric,
        server_id=server_id,
        container_name=container_name,
        points=points,
    )