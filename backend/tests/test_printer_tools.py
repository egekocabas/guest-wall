from unittest.mock import AsyncMock

import pytest

from guestwall.printer import PrinterAgentError


def test_printer_links_and_fixed_destinations(client, printer, settings):
    from pydantic import HttpUrl

    settings.home_url = HttpUrl("https://home.test/")
    settings.public_url = HttpUrl("https://public.test/")
    printer.print_qr = AsyncMock()
    assert client.get("/api/admin/printer/links").json() == {
        "home_url": "https://home.test/",
        "public_url": "https://public.test/",
    }
    for destination in ["home", "public"]:
        response = client.post(
            "/api/admin/printer/qr", json={"destination": destination, "label": "Welcome"}
        )
        assert response.status_code == 204
        printer.print_qr.assert_awaited_with(f"https://{destination}.test/", "Welcome")
    assert (
        client.post(
            "/api/admin/printer/qr", json={"destination": "home", "url": "https://other.test/"}
        ).status_code
        == 422
    )
    assert client.get("/api/admin/photos").json()["total"] == 0


def test_unconfigured_qr_does_not_print(client, printer):
    printer.print_qr = AsyncMock()
    assert client.post("/api/admin/printer/qr", json={"destination": "home"}).status_code == 409
    printer.print_qr.assert_not_awaited()


def test_feed_validation_and_errors(client, printer):
    printer.feed = AsyncMock()
    for lines in [1, 3, 255]:
        assert client.post("/api/admin/printer/feed", json={"lines": lines}).status_code == 204
        printer.feed.assert_awaited_with(lines)
    for lines in [0, 256, 1.5, True, "3"]:
        assert client.post("/api/admin/printer/feed", json={"lines": lines}).status_code == 422
    printer.feed.side_effect = PrinterAgentError(
        "Check the paper.", code="print_outcome_unknown", retryable=False, ambiguous=True
    )
    response = client.post("/api/admin/printer/feed", json={"lines": 3})
    assert response.status_code == 503
    assert response.json()["detail"]["retryable"] is False
    assert client.get("/api/admin/printer/status").json()["hardware_status"] == "ready"


@pytest.mark.parametrize(
    "path",
    [
        "/api/admin/printer/status",
        "/api/admin/printer/links",
        "/api/admin/printer/feed",
        "/api/admin/printer/qr",
        "/api/printer/status",
        "/api/admin/photos",
        "/api/photos",
        "/api/previews",
        "/admin",
        "/docs",
        "/openapi.json",
    ],
)
@pytest.mark.parametrize("method", ["GET", "POST", "HEAD", "OPTIONS", "PATCH", "DELETE"])
def test_public_host_blocks_private_apis(client, path, method):
    response = client.request(method, path, headers={"Host": "public.test"})
    assert response.status_code == 404


@pytest.mark.parametrize("path,body", [("feed", {"lines": 3}), ("qr", {"destination": "home"})])
def test_printer_actions_block_cross_site_requests(client, path, body):
    assert (
        client.post(
            f"/api/admin/printer/{path}", json=body, headers={"Origin": "https://other.test"}
        ).status_code
        == 403
    )
