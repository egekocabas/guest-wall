import asyncio
import base64

import httpx
import pytest

from guestwall.printer import PrinterAgentClient, PrinterAgentError

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
