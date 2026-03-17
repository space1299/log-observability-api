"""Pytest configuration and shared fixtures.

The application requires live database credentials at import time (config.py
raises ValueError if env vars are missing).  Set dummy values before any
project modules are imported, then mock the engine's connect() call so the
startup lifespan check passes without a real database.
"""

import os

# Must be set before any project module is imported so config._require() passes.
os.environ.setdefault("LOG_DB_HOST", "localhost")
os.environ.setdefault("LOG_DB_USER", "testuser")
os.environ.setdefault("LOG_DB_PASSWORD", "testpass")
os.environ.setdefault("LOG_DB_NAME", "testdb")

from contextlib import asynccontextmanager
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient


@pytest.fixture(scope="session")
def client():
    """Return a TestClient with the DB startup check mocked out."""
    mock_conn = MagicMock()
    mock_conn.__enter__ = MagicMock(return_value=mock_conn)
    mock_conn.__exit__ = MagicMock(return_value=False)

    with patch("util.db.engine.connect", return_value=mock_conn):
        # Import after env vars are set and engine.connect is patched.
        from main import create_app

        app = create_app()
        with TestClient(app, raise_server_exceptions=False) as c:
            yield c
