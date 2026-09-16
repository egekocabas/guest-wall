from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from guestwall.config import Settings
from guestwall.main import create_app


@pytest.mark.parametrize("method", ["GET", "HEAD"])
def test_public_robots_serves_frontend_policy(settings: Settings, method: str) -> None:
    public_dir = Path(__file__).resolve().parents[2] / "frontend" / "public"
    app = create_app(settings, auto_create_schema=True, frontend_dir=public_dir)

    with TestClient(app) as client:
        response = client.request(method, "/robots.txt", headers={"Host": settings.public_host})

    assert response.status_code == 200
    assert response.headers["content-type"] == "text/plain; charset=utf-8"
    assert response.headers["cache-control"] == "no-cache"
    assert response.headers["x-content-type-options"] == "nosniff"
    policy = (public_dir / "robots.txt").read_bytes()
    assert response.headers["content-length"] == str(len(policy))
    assert response.content == (policy if method == "GET" else b"")


def test_missing_robots_returns_not_found(settings: Settings, tmp_path: Path) -> None:
    app = create_app(settings, auto_create_schema=True, frontend_dir=tmp_path)

    with TestClient(app) as client:
        response = client.get("/robots.txt", headers={"Host": settings.public_host})

    assert response.status_code == 404
