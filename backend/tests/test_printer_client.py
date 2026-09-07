import asyncio
import base64

import httpx
import pytest

from guestwall.printer import (
    PrinterAgentClient,
    PrinterAgentError,
    PrinterHardwareStatus,
)

from .conftest import ENHANCED, EXACT


def client_with(transport: httpx.MockTransport) -> PrinterAgentClient:
    client = PrinterAgentClient("http://printer.test")
    asyncio.run(client.close())
    client._client = httpx.AsyncClient(  # type: ignore[attr-defined]
        base_url="http://printer.test", transport=transport
    )
    return client


def test_printer_client_decodes_both_distinct_pngs() -> None:
    async def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/preview/image"
        assert request.url.params["response"] == "json"
        assert b"original-phone-image" in await request.aread()
        return httpx.Response(
            200,
            json={
                "exact_print_image": base64.b64encode(EXACT).decode(),
                "enhanced_preview_image": base64.b64encode(ENHANCED).decode(),
            },
        )

    client = client_with(httpx.MockTransport(handler))
    try:
        result = asyncio.run(client.preview(b"original-phone-image", "image/heic"))
        assert result.exact_print == EXACT
        assert result.enhanced_preview == ENHANCED
    finally:
        asyncio.run(client.close())


def test_printer_client_forwards_optional_date_and_time() -> None:
    async def handler(request: httpx.Request) -> httpx.Response:
        body = await request.aread()
        assert b'name="date"' in body
        assert b"24/08/2026" in body
        assert b'name="time"' in body
        assert b"18:34" in body
        return httpx.Response(
            200,
            json={
                "exact_print_image": base64.b64encode(EXACT).decode(),
                "enhanced_preview_image": base64.b64encode(ENHANCED).decode(),
            },
        )

    client = client_with(httpx.MockTransport(handler))
    try:
        asyncio.run(client.preview(b"image", "image/jpeg", "24/08/2026", "18:34"))
    finally:
        asyncio.run(client.close())


def test_printer_client_sends_prepared_png_unchanged() -> None:
    seen: list[bytes] = []

    async def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/printer/status":
            return httpx.Response(200, json={"reachable": True, "hardware_status": "ready"})
        assert request.url.path == "/print/prepared-image"
        seen.append(await request.aread())
        return httpx.Response(204)

    client = client_with(httpx.MockTransport(handler))
    try:
        asyncio.run(client.print_prepared(EXACT))
        assert len(seen) == 1
        assert EXACT in seen[0]
        assert ENHANCED not in seen[0]
    finally:
        asyncio.run(client.close())


def test_invalid_printer_preview_is_translated() -> None:
    async def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={"exact_print_image": "not base64", "enhanced_preview_image": "also bad"},
        )

    client = client_with(httpx.MockTransport(handler))
    try:
        with pytest.raises(PrinterAgentError, match="invalid preview") as caught:
            asyncio.run(client.preview(b"image", "image/jpeg"))
        assert caught.value.code == "invalid_printer_response"
    finally:
        asyncio.run(client.close())


def test_print_failure_includes_printer_agent_reason() -> None:
    async def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/printer/status":
            return httpx.Response(200, json={"reachable": True, "hardware_status": "ready"})
        assert request.url.path == "/print/prepared-image"
        return httpx.Response(
            503,
            json={"detail": "Configured USB printer is unavailable"},
        )

    client = client_with(httpx.MockTransport(handler))
    try:
        with pytest.raises(PrinterAgentError) as caught:
            asyncio.run(client.print_prepared(EXACT))
        assert str(caught.value) == (
            "The printer reported an error: Configured USB printer is unavailable. "
            "Your photo was not added to the wall."
        )
        assert caught.value.code == "print_failed"
        assert caught.value.retryable is True
        assert caught.value.ambiguous is False
    finally:
        asyncio.run(client.close())


def test_rejected_prepared_print_does_not_blame_original_photo() -> None:
    async def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/printer/status":
            return httpx.Response(200, json={"reachable": True, "hardware_status": "ready"})
        return httpx.Response(400, json={"detail": "Prepared image must be a 1-bit PNG"})

    client = client_with(httpx.MockTransport(handler))
    try:
        with pytest.raises(PrinterAgentError) as caught:
            asyncio.run(client.print_prepared(EXACT))
        assert str(caught.value) == (
            "The printer service rejected the prepared print: Prepared image must be a 1-bit PNG. "
            "Your original photo is not the problem."
        )
        assert caught.value.code == "print_request_rejected"
        assert caught.value.retryable is False
    finally:
        asyncio.run(client.close())


@pytest.mark.parametrize(
    ("raw_status", "expected"),
    [
        ("ready", PrinterHardwareStatus.READY),
        ("paper_out", PrinterHardwareStatus.PAPER_OUT),
        ("error", PrinterHardwareStatus.ERROR),
        ("unknown", PrinterHardwareStatus.UNKNOWN),
        ("future_status", PrinterHardwareStatus.UNKNOWN),
        (None, None),
    ],
)
def test_printer_status_parses_hardware_status(
    raw_status: str | None,
    expected: PrinterHardwareStatus | None,
) -> None:
    async def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/printer/status"
        return httpx.Response(
            200,
            json={"reachable": True, "hardware_status": raw_status},
        )

    client = client_with(httpx.MockTransport(handler))
    try:
        status = asyncio.run(client.status())
        assert status.reachable is True
        assert status.hardware_status is expected
    finally:
        asyncio.run(client.close())


def test_printer_status_failure_is_offline() -> None:
    async def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(503)

    client = client_with(httpx.MockTransport(handler))
    try:
        status = asyncio.run(client.status())
        assert status.reachable is False
        assert status.hardware_status is None
    finally:
        asyncio.run(client.close())


@pytest.mark.parametrize(
    ("reachable", "hardware_status", "code"),
    [
        (False, None, "printer_unavailable"),
        (True, "paper_out", "printer_paper_out"),
        (True, "error", "printer_error"),
        (True, "unknown", "printer_not_ready"),
        (True, "future_status", "printer_not_ready"),
    ],
)
def test_print_preflight_blocks_printer_that_is_not_ready(
    reachable: bool,
    hardware_status: str | None,
    code: str,
) -> None:
    paths: list[str] = []

    async def handler(request: httpx.Request) -> httpx.Response:
        paths.append(request.url.path)
        return httpx.Response(
            200,
            json={"reachable": reachable, "hardware_status": hardware_status},
        )

    client = client_with(httpx.MockTransport(handler))
    try:
        with pytest.raises(PrinterAgentError) as caught:
            asyncio.run(client.print_prepared(EXACT))
        assert caught.value.code == code
        assert caught.value.retryable is True
        assert caught.value.ambiguous is False
        assert paths == ["/printer/status"]
    finally:
        asyncio.run(client.close())


@pytest.mark.parametrize("hardware_status", ["ready", None])
def test_print_preflight_allows_ready_or_unsupported_status(
    hardware_status: str | None,
) -> None:
    paths: list[str] = []

    async def handler(request: httpx.Request) -> httpx.Response:
        paths.append(request.url.path)
        if request.url.path == "/printer/status":
            return httpx.Response(
                200,
                json={"reachable": True, "hardware_status": hardware_status},
            )
        return httpx.Response(204)

    client = client_with(httpx.MockTransport(handler))
    try:
        asyncio.run(client.print_prepared(EXACT))
        assert paths == ["/printer/status", "/print/prepared-image"]
    finally:
        asyncio.run(client.close())


@pytest.mark.parametrize(
    "operation,payload",
    [
        ("feed", {"lines": 5}),
        ("qr", {"data": "https://home.test/", "label": "Welcome", "align": "center", "size": 6}),
    ],
)
def test_admin_tools_send_json_after_preflight(operation, payload):
    import json

    paths = []

    def handle(request):
        paths.append(request.url.path)
        if request.url.path == "/printer/status":
            return httpx.Response(200, json={"reachable": True, "hardware_status": "ready"})
        assert json.loads(request.content) == payload
        return httpx.Response(200, json={"status": "printed"})

    client = client_with(httpx.MockTransport(handle))

    async def run():
        try:
            if operation == "feed":
                await client.feed(5)
            else:
                await client.print_qr("https://home.test/", "Welcome")
        finally:
            await client.close()

    asyncio.run(run())
    assert paths == ["/printer/status", f"/print/{operation}"]


@pytest.mark.parametrize("failure", ["timeout", "disconnect", "connect", "rejected", "server"])
def test_tool_failures_are_not_retried(failure):
    paths = []

    def handle(request):
        paths.append(request.url.path)
        if request.url.path == "/printer/status":
            return httpx.Response(200, json={"reachable": True, "hardware_status": "ready"})
        if failure == "timeout":
            raise httpx.ReadTimeout("timeout", request=request)
        if failure == "disconnect":
            raise httpx.ReadError("disconnect", request=request)
        if failure == "connect":
            raise httpx.ConnectError("offline", request=request)
        return httpx.Response(422 if failure == "rejected" else 500, json={"detail": "Failed"})

    client = client_with(httpx.MockTransport(handle))
    with pytest.raises(PrinterAgentError) as caught:
        asyncio.run(client.feed(3))
    assert caught.value.ambiguous == (failure in {"timeout", "disconnect", "server"})
    assert caught.value.retryable == (failure == "connect")
    assert paths == ["/printer/status", "/print/feed"]
    asyncio.run(client.close())


def test_tool_blocks_paper_out_before_printing():
    paths = []

    def handle(request):
        paths.append(request.url.path)
        return httpx.Response(200, json={"reachable": True, "hardware_status": "paper_out"})

    client = client_with(httpx.MockTransport(handle))
    with pytest.raises(PrinterAgentError) as caught:
        asyncio.run(client.feed(3))
    assert caught.value.code == "printer_paper_out"
    assert paths == ["/printer/status"]
    asyncio.run(client.close())
