from collections.abc import Iterator
from typing import cast

from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    Header,
    Query,
    Request,
    Response,
    UploadFile,
    status,
)
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from guestwall.models import Photo, Visibility
from guestwall.printer import PrinterAgentError
from guestwall.schemas import (
    ConfirmPreview,
    PaperFeed,
    PhotoPage,
    PhotoView,
    PreviewCreated,
    PrinterLinks,
    PrinterStatus,
    VisibilityUpdate,
    WallQr,
)
from guestwall.services import GuestwallService, ServiceError

router = APIRouter()


def get_session(request: Request) -> Iterator[Session]:
    yield from request.app.state.database.session()


def get_service(request: Request) -> GuestwallService:
    return cast(GuestwallService, request.app.state.service)


def photo_view(photo: Photo, image_prefix: str) -> PhotoView:
    return PhotoView(
        id=photo.id,
        created_at=photo.created_at,
        visibility=Visibility(photo.visibility),
        print_status=photo.print_status,
        image_url=f"{image_prefix}/{photo.id}/image",
    )


@router.post("/api/previews", response_model=PreviewCreated, status_code=status.HTTP_201_CREATED)
async def create_preview(
    request: Request,
    image: UploadFile = File(...),
    date: str | None = Form(None),
    time: str | None = Form(None),
    session: Session = Depends(get_session),
    service: GuestwallService = Depends(get_service),
) -> PreviewCreated:
    limit = request.app.state.settings.max_upload_bytes
    original = await image.read(limit + 1)
    record = await service.create_preview(
        session,
        original,
        image.content_type or "application/octet-stream",
        date,
        time,
    )
    return PreviewCreated(
        preview_id=record.id,
        preview_url=f"/api/previews/{record.id}/image",
        expires_at=record.expires_at,
    )


@router.get("/api/previews/{preview_id}/image", response_class=FileResponse)
def preview_image(
    preview_id: str,
    session: Session = Depends(get_session),
    service: GuestwallService = Depends(get_service),
) -> FileResponse:
    _, path = service.get_preview(session, preview_id)
    return FileResponse(path, media_type="image/png", headers={"Cache-Control": "no-store"})


@router.delete("/api/previews/{preview_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_preview(
    preview_id: str,
    session: Session = Depends(get_session),
    service: GuestwallService = Depends(get_service),
) -> Response:
    service.delete_preview(session, preview_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/api/previews/{preview_id}/confirm", response_model=PhotoView)
async def confirm_preview(
    preview_id: str,
    body: ConfirmPreview,
    response: Response,
    session: Session = Depends(get_session),
    service: GuestwallService = Depends(get_service),
) -> PhotoView:
    photo, duplicate = await service.confirm(
        session,
        preview_id,
        body.visibility,
        print_photo=body.print,
    )
    response.headers["Idempotency-Replayed"] = "true" if duplicate else "false"
    return photo_view(photo, "/api/photos")


@router.get("/api/photos", response_model=PhotoPage)
def list_lan_photos(
    offset: int = Query(0, ge=0),
    limit: int = Query(24, ge=1, le=100),
    session: Session = Depends(get_session),
    service: GuestwallService = Depends(get_service),
) -> PhotoPage:
    photos, next_offset, total = service.list_photos(
        session, public_only=False, offset=offset, limit=limit
    )
    return PhotoPage(
        items=[photo_view(photo, "/api/photos") for photo in photos],
        next_offset=next_offset,
        total=total,
    )


@router.get("/api/photos/{photo_id}/image", response_class=FileResponse)
def lan_photo_image(
    photo_id: str,
    session: Session = Depends(get_session),
    service: GuestwallService = Depends(get_service),
) -> FileResponse:
    photo = service.get_photo(session, photo_id, public_only=False)
    return FileResponse(
        service.storage.resolve(photo.preview_path),
        media_type="image/png",
        headers={"Cache-Control": "private, max-age=3600"},
    )


@router.get("/api/public/photos", response_model=PhotoPage)
def list_public_photos(
    offset: int = Query(0, ge=0),
    limit: int = Query(24, ge=1, le=100),
    session: Session = Depends(get_session),
    service: GuestwallService = Depends(get_service),
) -> PhotoPage:
    photos, next_offset, total = service.list_photos(
        session, public_only=True, offset=offset, limit=limit
    )
    return PhotoPage(
        items=[photo_view(photo, "/api/public/photos") for photo in photos],
        next_offset=next_offset,
        total=total,
    )


@router.get("/api/public/photos/{photo_id}/image", response_class=FileResponse)
def public_photo_image(
    photo_id: str,
    session: Session = Depends(get_session),
    service: GuestwallService = Depends(get_service),
) -> FileResponse:
    photo = service.get_photo(session, photo_id, public_only=True)
    return FileResponse(
        service.storage.resolve(photo.preview_path),
        media_type="image/png",
        headers={"Cache-Control": "public, max-age=3600"},
    )


@router.get("/api/printer/status", response_model=PrinterStatus)
async def printer_status(service: GuestwallService = Depends(get_service)) -> PrinterStatus:
    status = await service.printer.status()
    return PrinterStatus(online=status.reachable, hardware_status=status.hardware_status)


@router.get("/api/admin/photos", response_model=PhotoPage)
def admin_photos(
    offset: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=100),
    session: Session = Depends(get_session),
    service: GuestwallService = Depends(get_service),
) -> PhotoPage:
    photos, next_offset, total = service.list_photos(
        session, public_only=False, offset=offset, limit=limit
    )
    return PhotoPage(
        items=[photo_view(photo, "/api/photos") for photo in photos],
        next_offset=next_offset,
        total=total,
    )


@router.patch("/api/admin/photos/{photo_id}", response_model=PhotoView)
def update_photo(
    photo_id: str,
    body: VisibilityUpdate,
    session: Session = Depends(get_session),
    service: GuestwallService = Depends(get_service),
) -> PhotoView:
    return photo_view(service.set_visibility(session, photo_id, body.visibility), "/api/photos")


@router.delete("/api/admin/photos/{photo_id}", status_code=status.HTTP_204_NO_CONTENT)
def admin_delete_photo(
    photo_id: str,
    session: Session = Depends(get_session),
    service: GuestwallService = Depends(get_service),
) -> Response:
    service.delete_photo(session, photo_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/api/admin/photos/{photo_id}/reprint", status_code=status.HTTP_204_NO_CONTENT)
async def admin_reprint_photo(
    photo_id: str,
    idempotency_key: str = Header(..., alias="Idempotency-Key"),
    session: Session = Depends(get_session),
    service: GuestwallService = Depends(get_service),
) -> Response:
    replayed = await service.reprint(session, photo_id, idempotency_key)
    return Response(
        status_code=status.HTTP_204_NO_CONTENT,
        headers={"Idempotency-Replayed": "true" if replayed else "false"},
    )


@router.get("/api/admin/printer/status", response_model=PrinterStatus)
async def admin_printer_status(service: GuestwallService = Depends(get_service)) -> PrinterStatus:
    return await printer_status(service)


@router.get("/api/admin/printer/links", response_model=PrinterLinks)
def printer_links(service: GuestwallService = Depends(get_service)) -> PrinterLinks:
    return PrinterLinks(
        home_url=str(service.settings.home_url) if service.settings.home_url else None,
        public_url=str(service.settings.public_url) if service.settings.public_url else None,
    )


@router.post("/api/admin/printer/feed", status_code=status.HTTP_204_NO_CONTENT)
async def admin_feed(body: PaperFeed, service: GuestwallService = Depends(get_service)) -> Response:
    try:
        await service.printer.feed(body.lines)
    except PrinterAgentError as exc:
        raise ServiceError(503, str(exc), exc.code, retryable=exc.retryable) from exc
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/api/admin/printer/qr", status_code=status.HTTP_204_NO_CONTENT)
async def admin_qr(body: WallQr, service: GuestwallService = Depends(get_service)) -> Response:
    url = service.settings.home_url if body.destination == "home" else service.settings.public_url
    if url is None:
        raise ServiceError(409, "This wall URL has not been configured.", "wall_url_missing")
    try:
        await service.printer.print_qr(str(url), body.label)
    except PrinterAgentError as exc:
        raise ServiceError(503, str(exc), exc.code, retryable=exc.retryable) from exc
    return Response(status_code=status.HTTP_204_NO_CONTENT)
