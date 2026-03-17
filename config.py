import os
from urllib.parse import quote_plus


def _require(name: str) -> str:
    """Return the value of a required environment variable.

    Raises ``ValueError`` at import time if the variable is not set,
    ensuring the application fails fast rather than connecting with
    accidental default credentials.
    """
    value = os.getenv(name)
    if not value:
        raise ValueError(
            f"Required environment variable '{name}' is not set. "
            "Copy .env.example to .env and fill in the values."
        )
    return value


LOG_DB_HOST = _require("LOG_DB_HOST")
LOG_DB_PORT = int(os.getenv("LOG_DB_PORT", "5432"))
LOG_DB_USER = _require("LOG_DB_USER")
LOG_DB_PASSWORD = _require("LOG_DB_PASSWORD")
LOG_DB_NAME = _require("LOG_DB_NAME")


def get_database_url() -> str:
    """Build a psycopg2 connection URL from environment-provided credentials."""
    user = quote_plus(LOG_DB_USER)
    password = quote_plus(LOG_DB_PASSWORD)
    return f"postgresql+psycopg2://{user}:{password}@{LOG_DB_HOST}:{LOG_DB_PORT}/{LOG_DB_NAME}"
