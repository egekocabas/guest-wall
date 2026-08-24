import asyncio
import contextlib
import logging
import time
from collections.abc import AsyncIterator
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles
from prometheus_client import CONTENT_TYPE_LATEST, generate_latest
from sqlalchemy.exc import SQLAlchemyError
from starlette.responses import Response

from guestwall.api import router
from guestwall.config import Settings, get_settings
from guestwall.database import Database, check_database
from guestwall.logging_config import configure_logging
from guestwall.printer import PrinterAgentClient
from guestwall.services import GuestwallService, ServiceError
from guestwall.storage import FileStorage

logger = logging.getLogger("guestwall.http")


def create_app(
    settings: Settings | None = None,
    printer_client: PrinterAgentClient | None = None,
    *,
    auto_create_schema: bool = False,
    frontend_dir: Path | None = None,
) -> FastAPI:
    resolved_settings = settings or get_settings()
    configure_logging(resolved_settings.log_level)
    storage = FileStorage(resolved_settings.data_dir)
    storage.initialize()
    database = Database(resolved_settings.effective_database_url)
    if auto_create_schema:
        database.create_schema_for_tests()
    printer = printer_client or PrinterAgentClient(
        resolved_settings.printer_agent_url,
        resolved_settings.printer_timeout_seconds,
    )
    owns_printer = printer_client is None
    service = GuestwallService(resolved_settings, storage, printer)

    @contextlib.asynccontextmanager
    async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
        with database.sessions() as session:
            service.cleanup_expired(session)
            service.refresh_metrics(session)
        cleanup_task = asyncio.create_task(_cleanup_loop(database, service, resolved_settings))
        yield
        cleanup_task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await cleanup_task
        if owns_printer:
            await printer.close()
        database.dispose()

    app = FastAPI(title="Guestwall", version="0.1.0", lifespan=lifespan)
    app.state.settings = resolved_settings
    app.state.database = database
    app.state.service = service

    @app.exception_handler(ServiceError)
    async def service_error_handler(_request: Request, exc: ServiceError) -> JSONResponse:
        return JSONResponse(
            status_code=exc.status_code,
            content={
                "detail": {
                    "message": exc.message,
                    "code": exc.code,
                    "retryable": exc.retryable,
                }
            },
        )

    @app.middleware("http")
    async def security_and_boundaries(request: Request, call_next: object) -> object:
        started = time.perf_counter()
        host = request.url.hostname or ""
        path = request.url.path
        content_length = request.headers.get("content-length")
        upload_too_large = (
            request.method == "POST"
            and path == "/api/previews"
            and content_length is not None
            and content_length.isdigit()
            and int(content_length) > resolved_settings.max_upload_bytes + 65536
        )
        if upload_too_large:
            response = JSONResponse(
                status_code=413,
                content={
                    "detail": {
                        "message": "This photo is too large. Choose a smaller one.",
                        "code": "upload_too_large",
                        "retryable": False,
                    }
                },
            )
        elif host == resolved_settings.public_host and not _is_public_path(path):
            response = JSONResponse(status_code=404, content={"detail": "Not found"})
        elif request.method not in {"GET", "HEAD", "OPTIONS"} and _cross_site(request):
            response = JSONResponse(
                status_code=403, content={"detail": "Cross-site request blocked"}
            )
        else:
            response = await call_next(request)  # type: ignore[operator]
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "same-origin"
        response.headers["Permissions-Policy"] = "camera=(self), geolocation=()"
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; img-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; "
            "script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'"
        )
        logger.info(
            "request",
            extra={
                "method": request.method,
                "path": path,
                "status_code": response.status_code,
                "duration_ms": round((time.perf_counter() - started) * 1000, 2),
            },
        )
        return response

    @app.get("/health/live", include_in_schema=False)
    def live() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/health/ready", include_in_schema=False)
    def ready() -> JSONResponse:
        try:
            check_database(database.engine)
            storage.initialize()
            return JSONResponse({"status": "ok"})
        except (OSError, SQLAlchemyError):
            return JSONResponse({"status": "not_ready"}, status_code=503)

    @app.get("/metrics", include_in_schema=False)
    def metrics() -> PlainTextResponse:
        return PlainTextResponse(generate_latest(), media_type=CONTENT_TYPE_LATEST)

    app.include_router(router)

    static_root = frontend_dir or Path(__file__).parent / "static"
    assets = static_root / "assets"
    if assets.is_dir():
        app.mount("/assets", StaticFiles(directory=assets), name="assets")

    @app.get("/", include_in_schema=False)
    @app.get("/admin", include_in_schema=False)
    @app.get("/admin/{rest:path}", include_in_schema=False)
    def spa(rest: str = "") -> Response:
        index = static_root / "index.html"
        if not index.is_file():
            return JSONResponse(
                {"detail": "Frontend assets are not built. Use the Vite development server."},
                status_code=503,
            )
        return FileResponse(index, headers={"Cache-Control": "no-cache"})

    return app


async def _cleanup_loop(database: Database, service: GuestwallService, settings: Settings) -> None:
    while True:
        await asyncio.sleep(settings.preview_cleanup_interval_seconds)
        with database.sessions() as session:
            removed = service.cleanup_expired(session)
            if removed:
                logging.getLogger("guestwall.cleanup").info("expired previews removed: %s", removed)


def _is_public_path(path: str) -> bool:
    return (
        path == "/"
        or path in {"/favicon.svg", "/robots.txt", "/health/live", "/health/ready"}
        or path.startswith(("/assets/", "/api/public/"))
    )


def _cross_site(request: Request) -> bool:
    if request.headers.get("sec-fetch-site") == "cross-site":
        return True
    origin = request.headers.get("origin")
    return bool(origin and origin.rstrip("/") != str(request.base_url).rstrip("/"))


app = create_app()
