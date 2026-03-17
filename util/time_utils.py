"""Shared time-window utilities for query range validation."""

from datetime import datetime, timedelta, timezone
from typing import Optional, Tuple

from fastapi import HTTPException


def normalize_window(
    since: Optional[datetime],
    until: Optional[datetime],
    default_hours: int = 1,
    max_hours: int = 48,
) -> Tuple[datetime, datetime]:
    """Validate and normalise a *since* / *until* query window.

    Rules
    -----
    - Both ``None`` → last ``default_hours``.
    - Only ``since`` given → extend forward by ``max_hours``.
    - Only ``until`` given → extend backward by ``max_hours``.
    - ``until < since`` → HTTP 400.
    - Window wider than ``max_hours`` → HTTP 400.

    Returns
    -------
    Tuple of (since, until) with UTC timezone.
    """
    now = datetime.now(timezone.utc)

    if since and until:
        if until < since:
            raise HTTPException(
                status_code=400,
                detail="'until' must be greater than or equal to 'since'.",
            )
    elif since and not until:
        until = since + timedelta(hours=max_hours)
    elif until and not since:
        since = until - timedelta(hours=max_hours)
    else:
        until = now
        since = now - timedelta(hours=default_hours)

    if until - since > timedelta(hours=max_hours):
        raise HTTPException(
            status_code=400,
            detail=f"Query window cannot exceed {max_hours} hours.",
        )

    return since, until
