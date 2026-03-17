"""Smoke tests — verify the application starts and key routes are reachable.

These tests do not require a real database; the DB connection is mocked in
conftest.py.  Any test that actually queries the database will receive a 500
(which is still a valid response for verifying the route exists).
"""


def test_health_ok(client):
    """Health endpoint returns 200 and the expected JSON body."""
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


def test_openapi_schema_contains_expected_paths(client):
    """OpenAPI schema is generated and includes the main API paths."""
    resp = client.get("/openapi.json")
    assert resp.status_code == 200
    paths = resp.json().get("paths", {})
    assert "/health" in paths
    assert "/v1/logs" in paths
    assert "/v1/logs/export" in paths
    assert "/v1/status" in paths
    assert "/v1/servers" in paths


def test_docs_page_is_accessible(client):
    """Swagger UI docs page is served."""
    resp = client.get("/docs")
    assert resp.status_code == 200


def test_logs_endpoint_exists(client):
    """GET /v1/logs is registered; without a DB it returns 500, not 404."""
    resp = client.get("/v1/logs?server_id=smoke&container_name=test")
    assert resp.status_code != 404


def test_status_endpoint_exists(client):
    """GET /v1/status is registered; without a DB it returns 500, not 404."""
    resp = client.get("/v1/status?server_id=smoke")
    assert resp.status_code != 404


def test_servers_endpoint_exists(client):
    """GET /v1/servers is registered."""
    resp = client.get("/v1/servers")
    assert resp.status_code != 404
