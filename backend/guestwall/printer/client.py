import base64
import binascii
from dataclasses import dataclass

import httpx

from guestwall.metrics import PRINTER_REQUEST_DURATION

PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"


class PrinterAgentError(Exception):
    def __init__(self, message: str, *, code: str, retryable: bool, ambiguous: bool = False):
        super().__init__(message)
        self.code = code
        self.retryable = retryable
        self.ambiguous = ambiguous


@dataclass(frozen=True)
class PreparedImages:
    exact_print: bytes
    enhanced_preview: bytes


class PrinterAgentClient:
    def __init__(self, base_url: str, timeout_seconds: float = 30) -> None:
        self._client = httpx.AsyncClient(
            base_url=base_url.rstrip("/"),
            timeout=httpx.Timeout(timeout_seconds),
        )

    async def close(self) -> None:
        await self._client.aclose()

    async def preview(
        self,
        image: bytes,
        content_type: str,
        date: str | None = None,
        time: str | None = None,
    ) -> PreparedImages:
        caption = {}
        if date is not None:
            caption["date"] = date
        if time is not None:
            caption["time"] = time
        try:
            with PRINTER_REQUEST_DURATION.labels(operation="preview").time():
                response = await self._client.post(
                    "/preview/image",
                    params={"response": "json"},
                    data=caption,
                    files={"image": ("upload", image, content_type)},
                )
            response.raise_for_status()
            payload = response.json()
            return PreparedImages(
                exact_print=self._decode_png(payload["exact_print_image"]),
                enhanced_preview=self._decode_png(payload["enhanced_preview_image"]),
            )
        except (KeyError, ValueError, binascii.Error) as exc:
            raise PrinterAgentError(
                "The printer service returned an invalid preview.",
                code="invalid_printer_response",
                retryable=True,
            ) from exc
        except httpx.TimeoutException as exc:
            raise PrinterAgentError(
                "The printer service timed out.",
                code="printer_timeout",
                retryable=True,
            ) from exc
        except httpx.HTTPStatusError as exc:
            code = (
                "unsupported_image"
                if exc.response.status_code in {400, 415, 422}
                else "preview_failed"
            )
            raise PrinterAgentError(
                "The printer service could not prepare this image.",
                code=code,
                retryable=True,
            ) from exc
        except httpx.RequestError as exc:
            raise PrinterAgentError(
                "The printer service is unavailable.",
                code="printer_unavailable",
                retryable=True,
            ) from exc

    async def print_prepared(self, image: bytes) -> None:
        try:
            with PRINTER_REQUEST_DURATION.labels(operation="print").time():
                response = await self._client.post(
                    "/print/prepared-image",
                    files={"image": ("print.png", image, "image/png")},
                )
            response.raise_for_status()
        except httpx.TimeoutException as exc:
            raise PrinterAgentError(
                "The printer did not confirm whether printing completed.",
                code="print_outcome_unknown",
                retryable=False,
                ambiguous=True,
            ) from exc
        except httpx.HTTPStatusError as exc:
            raise PrinterAgentError(
                "The printer could not print this photo.",
                code="print_failed",
                retryable=True,
            ) from exc
        except httpx.ConnectError as exc:
            raise PrinterAgentError(
                "The printer is unavailable.",
                code="printer_unavailable",
                retryable=True,
            ) from exc
        except httpx.RequestError as exc:
            raise PrinterAgentError(
                "The printer outcome is unknown.",
                code="print_outcome_unknown",
                retryable=False,
                ambiguous=True,
            ) from exc

    async def healthy(self) -> bool:
        try:
            response = await self._client.get("/health", timeout=3)
            return response.is_success
        except httpx.RequestError:
            return False

    @staticmethod
    def _decode_png(value: object) -> bytes:
        if not isinstance(value, str):
            raise ValueError("expected base64 string")
        data = base64.b64decode(value, validate=True)
        if not data.startswith(PNG_SIGNATURE):
            raise ValueError("expected PNG")
        return data
