from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from guestwall.config import Settings
from guestwall.main import create_app


@pytest.mark.parametrize("method", ["GET", "HEAD"])
@pytest.mark.parametrize("public", [True, False])
def test_favicon_serves_frontend_icon(settings: Settings, method: str, public: bool) -> None:
    public_dir = Path(__file__).resolve().parents[2] / "frontend" / "public"
    app = create_app(settings, auto_create_schema=True, frontend_dir=public_dir)
    host = settings.public_host if public else "home.test"

    with TestClient(app) as client:
        response = client.request(method, "/favicon.svg", headers={"Host": host})

    assert response.status_code == 200
    assert response.headers["content-type"] == "image/svg+xml"
    assert response.headers["cache-control"] == "no-cache"
    assert response.headers["x-content-type-options"] == "nosniff"
    icon = (public_dir / "favicon.svg").read_bytes()
    assert response.headers["content-length"] == str(len(icon))
    assert response.content == (icon if method == "GET" else b"")


@pytest.mark.parametrize("method", ["GET", "HEAD"])
def test_missing_favicon_returns_not_found(settings: Settings, tmp_path: Path, method: str) -> None:
    (tmp_path / "index.html").write_text("<html>Guestwall</html>")
    app = create_app(settings, auto_create_schema=True, frontend_dir=tmp_path)

    with TestClient(app) as client:
        response = client.request(method, "/favicon.svg", headers={"Host": settings.public_host})

    assert response.status_code == 404
    assert b"<html>" not in response.content
