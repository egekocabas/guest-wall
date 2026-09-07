import base64
import binascii
from dataclasses import dataclass
from enum import StrEnum

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


class PrinterHardwareStatus(StrEnum):
    READY = "ready"
    PAPER_OUT = "paper_out"
    ERROR = "error"
    UNKNOWN = "unknown"


@dataclass(frozen=True)
class PrinterAgentStatus:
    reachable: bool
    hardware_status: PrinterHardwareStatus | None


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
        status = await self.status()
        self._require_ready(status)
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
            status_code = exc.response.status_code
            detail = self._error_detail(exc.response)
            if status_code in {400, 413, 415, 422}:
                message = "The printer service rejected the prepared print"
                if detail:
                    message += f": {detail}"
                raise PrinterAgentError(
                    f"{message}. Your original photo is not the problem.",
                    code="print_request_rejected",
                    retryable=False,
                ) from exc

            message = "The printer reported an error"
            if detail:
                message += f": {detail}"
            raise PrinterAgentError(
                f"{message}. Your photo was not added to the wall.",
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

    async def feed(self, lines: int) -> None:
        await self._print_tool("/print/feed", {"lines": lines})

    async def print_qr(self, url: str, label: str) -> None:
        await self._print_tool(
            "/print/qr", {"data": url, "label": label, "align": "center", "size": 6}
        )

    async def _print_tool(self, path: str, payload: dict[str, object]) -> None:
        self._require_ready(await self.status())
        try:
            with PRINTER_REQUEST_DURATION.labels(operation="print").time():
                response = await self._client.post(path, json=payload)
            response.raise_for_status()
        except httpx.ConnectError as exc:
            raise PrinterAgentError(
                "The printer service is unavailable.", code="printer_unavailable", retryable=True
            ) from exc
        except httpx.HTTPStatusError as exc:
            rejected = exc.response.status_code in {400, 413, 415, 422}
            detail = self._error_detail(exc.response)
            message = (
                "The printer rejected this request" if rejected else "The print outcome is unknown"
            )
            if detail:
                message += f": {detail}"
            if not rejected:
                message += ". Check the paper before sending another job"
            raise PrinterAgentError(
                message + ".",
                code="print_request_rejected" if rejected else "print_outcome_unknown",
                retryable=False,
                ambiguous=not rejected,
            ) from exc
        except httpx.RequestError as exc:
            raise PrinterAgentError(
                "The print outcome is unknown. Check the paper before sending another job.",
                code="print_outcome_unknown",
                retryable=False,
                ambiguous=True,
            ) from exc

    async def status(self) -> PrinterAgentStatus:
        try:
            response = await self._client.get("/printer/status", timeout=3)
            response.raise_for_status()
            payload = response.json()
            if not isinstance(payload, dict):
                raise ValueError("expected an object")
            reachable = payload.get("reachable") is True
            raw_hardware_status = payload.get("hardware_status")
            if raw_hardware_status is None:
                hardware_status = None
            else:
                try:
                    hardware_status = PrinterHardwareStatus(raw_hardware_status)
                except (TypeError, ValueError):
                    hardware_status = PrinterHardwareStatus.UNKNOWN
            return PrinterAgentStatus(
                reachable=reachable,
                hardware_status=hardware_status,
            )
        except (httpx.HTTPError, ValueError, AttributeError):
            return PrinterAgentStatus(reachable=False, hardware_status=None)

    @staticmethod
    def _require_ready(status: PrinterAgentStatus) -> None:
        if not status.reachable:
            raise PrinterAgentError(
                "The printer is unavailable. Check its power and connection, then try again.",
                code="printer_unavailable",
                retryable=True,
            )
        if status.hardware_status in {None, PrinterHardwareStatus.READY}:
            return
        if status.hardware_status is PrinterHardwareStatus.PAPER_OUT:
            raise PrinterAgentError(
                "The printer is out of paper. Add a roll and try again.",
                code="printer_paper_out",
                retryable=True,
            )
        if status.hardware_status is PrinterHardwareStatus.ERROR:
            raise PrinterAgentError(
                "The printer needs attention before printing can continue.",
                code="printer_error",
                retryable=True,
            )
        raise PrinterAgentError(
            "The printer is online but not ready. Check it and try again.",
            code="printer_not_ready",
            retryable=True,
        )

    @staticmethod
    def _error_detail(response: httpx.Response) -> str | None:
        try:
            detail = response.json().get("detail")
        except (ValueError, AttributeError):
            return None
        if not isinstance(detail, str):
            return None
        cleaned = " ".join(detail.split()).strip().rstrip(".")
        return cleaned[:200] or None

    @staticmethod
    def _decode_png(value: object) -> bytes:
        if not isinstance(value, str):
            raise ValueError("expected base64 string")
        data = base64.b64decode(value, validate=True)
        if not data.startswith(PNG_SIGNATURE):
            raise ValueError("expected PNG")
        return data
