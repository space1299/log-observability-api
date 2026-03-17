"""SQLAlchemy engine and session utilities."""

from typing import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from config import get_database_url

DATABASE_URL = get_database_url()

engine = create_engine(
    DATABASE_URL,
    future=True,
    # Validate connections before use — prevents stale-connection errors.
    pool_pre_ping=True,
    # Keep a modest connection pool; max_overflow allows short bursts.
    pool_size=5,
    max_overflow=10,
    # Kill any individual statement that runs longer than 30 seconds.
    # This protects the DB from runaway queries (e.g. missing index).
    connect_args={"options": "-c statement_timeout=30000"},
)

SessionLocal = sessionmaker(
    bind=engine,
    autocommit=False,
    autoflush=False,
    future=True,
)


def get_db() -> Generator[Session, None, None]:
    """FastAPI dependency that yields a database session and closes it on exit."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
