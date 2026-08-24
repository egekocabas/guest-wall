import re
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, cast
from uuid import uuid4

from sqlalchemy import func, select, update
from sqlalchemy.engine import CursorResult
from sqlalchemy.orm import Session

from guestwall.config import Settings
from guestwall.metrics import (
    PHOTOS,
    PREVIEW_REQUESTS,
    PRINT_FAILURES,
    PRINT_REQUESTS,
    PUBLIC_PHOTOS,
)
from guestwall.models import (
    Photo,
    PreviewSession,
    PreviewState,
    PrintStatus,
    Visibility,
    utcnow,
)
from guestwall.printer import PrinterAgentClient, PrinterAgentError
from guestwall.storage import FileStorage


class ServiceError(Exception):
    def __init__(self, status_code: int, message: str, code: str, *, retryable: bool = False):
        super().__init__(message)
        self.status_code = status_code
        self.message = message
        self.code = code
        self.retryable = retryable


class GuestwallService:
    def __init__(
        self,
        settings: Settings,
        storage: FileStorage,
        printer: PrinterAgentClient,
    ) -> None:
        self.settings = settings
        self.storage = storage
        self.printer = printer

    async def create_preview(
        self,
        session: Session,
        image: bytes,
        content_type: str,
        date: str | None = None,
        time: str | None = None,
    ) -> PreviewSession:
        PREVIEW_REQUESTS.inc()
        if not image:
            raise ServiceError(400, "Choose a photo to continue.", "empty_upload")
        if len(image) > self.settings.max_upload_bytes:
            raise ServiceError(
                413, "This photo is too large. Choose a smaller one.", "upload_too_large"
            )
        if not content_type.startswith("image/") and content_type != "application/octet-stream":
            raise ServiceError(415, "Choose an image file.", "invalid_content_type")

        self._validate_caption(date, time)

        try:
            prepared = await self.printer.preview(image, content_type, date, time)
        except PrinterAgentError as exc:
            raise ServiceError(503, str(exc), exc.code, retryable=exc.retryable) from exc

        preview_id = str(uuid4())
        try:
            preview_path, print_path = self.storage.write_preview(
                preview_id,
                prepared.enhanced_preview,
                prepared.exact_print,
            )
            record = PreviewSession(
                id=preview_id,
                expires_at=utcnow() + timedelta(seconds=self.settings.preview_ttl_seconds),
                state=PreviewState.READY.value,
                preview_path=preview_path,
                print_path=print_path,
            )
            session.add(record)
            session.commit()
            return record
        except Exception:
            session.rollback()
            self.storage.remove_preview(preview_id)
            raise

    @staticmethod
    def _validate_caption(date: str | None, time: str | None) -> None:
        if date is None:
            if time is not None:
                raise ServiceError(400, "A time caption also requires a date.", "date_required")
            return

        try:
            if not re.fullmatch(r"\d{2}/\d{2}/\d{4}", date):
                raise ValueError
            datetime.strptime(date, "%d/%m/%Y")
        except ValueError as exc:
            raise ServiceError(
                400,
                "The caption date must be a real date in DD/MM/YYYY format.",
                "invalid_caption_date",
            ) from exc

        if time is None:
            return
        try:
            if not re.fullmatch(r"\d{2}:\d{2}", time):
                raise ValueError
            datetime.strptime(time, "%H:%M")
        except ValueError as exc:
            raise ServiceError(
                400,
                "The caption time must be a real time in HH:MM format.",
                "invalid_caption_time",
            ) from exc

    def get_preview(self, session: Session, preview_id: str) -> tuple[PreviewSession, Path]:
        record = session.get(PreviewSession, preview_id)
        if record is None or record.state == PreviewState.PRINTED.value:
            raise ServiceError(404, "This preview is no longer available.", "preview_not_found")
        if record.expires_at <= utcnow():
            self._delete_preview_record(session, record)
            raise ServiceError(
                410, "This preview expired. Please choose the photo again.", "preview_expired"
            )
        path = self.storage.resolve(record.preview_path)
        if not path.is_file():
            raise ServiceError(404, "This preview is no longer available.", "preview_not_found")
        return record, path

    def delete_preview(self, session: Session, preview_id: str) -> None:
        record = session.get(PreviewSession, preview_id)
        if record is None:
            return
        if record.state in {PreviewState.PRINTING.value, PreviewState.PRINTED.value}:
            raise ServiceError(409, "This preview can no longer be removed.", "preview_busy")
        self._delete_preview_record(session, record)

    async def confirm(
        self,
        session: Session,
        preview_id: str,
        visibility: Visibility,
    ) -> tuple[Photo, bool]:
        PRINT_REQUESTS.inc()
        record = session.get(PreviewSession, preview_id)
        if record is None:
            raise ServiceError(404, "This preview is no longer available.", "preview_not_found")
        if record.state == PreviewState.PRINTED.value and record.photo_id:
            photo = session.get(Photo, record.photo_id)
            if photo is not None:
                return photo, True
        if record.expires_at <= utcnow():
            self._delete_preview_record(session, record)
            raise ServiceError(
                410, "This preview expired. Please choose the photo again.", "preview_expired"
            )
        if record.state == PreviewState.UNCERTAIN.value:
            raise ServiceError(
                409,
                "The printer outcome is unknown. Ask the host before trying again.",
                "print_outcome_unknown",
            )

        claimed = cast(
            CursorResult[Any],
            session.execute(
                update(PreviewSession)
                .where(
                    PreviewSession.id == preview_id,
                    PreviewSession.state.in_(
                        [
                            PreviewState.READY.value,
                            PreviewState.FAILED.value,
                        ]
                    ),
                )
                .values(state=PreviewState.PRINTING.value, error_code=None)
            ),
        )
        session.commit()
        if claimed.rowcount != 1:
            raise ServiceError(409, "This photo is already being printed.", "print_in_progress")

        exact_print = self.storage.read(record.print_path)
        try:
            await self.printer.print_prepared(exact_print)
        except PrinterAgentError as exc:
            PRINT_FAILURES.inc()
            next_state = PreviewState.UNCERTAIN if exc.ambiguous else PreviewState.FAILED
            session.execute(
                update(PreviewSession)
                .where(PreviewSession.id == preview_id)
                .values(state=next_state.value, error_code=exc.code)
            )
            session.commit()
            raise ServiceError(503, str(exc), exc.code, retryable=exc.retryable) from exc

        printed_at = utcnow()
        try:
            preview_path, print_path = self.storage.promote(preview_id, preview_id)
            photo = Photo(
                id=preview_id,
                visibility=visibility.value,
                preview_path=preview_path,
                print_path=print_path,
                print_status=PrintStatus.PRINTED.value,
                printed_at=printed_at,
            )
            session.add(photo)
            record.state = PreviewState.PRINTED.value
            record.photo_id = photo.id
            record.preview_path = preview_path
            record.print_path = print_path
            session.commit()
            self.refresh_metrics(session)
            return photo, False
        except Exception as exc:
            session.rollback()
            self.storage.demote(preview_id, preview_id)
            session.execute(
                update(PreviewSession)
                .where(PreviewSession.id == preview_id)
                .values(
                    state=PreviewState.UNCERTAIN.value, error_code="storage_failure_after_print"
                )
            )
            session.commit()
            raise ServiceError(
                500,
                "The photo printed, but could not be added to the wall. Ask the host for help.",
                "storage_failure_after_print",
            ) from exc

    def list_photos(
        self,
        session: Session,
        *,
        public_only: bool,
        offset: int,
        limit: int,
    ) -> tuple[list[Photo], int | None]:
        statement = select(Photo).order_by(Photo.created_at.desc()).offset(offset).limit(limit + 1)
        if public_only:
            statement = statement.where(Photo.visibility == Visibility.PUBLIC.value)
        photos = list(session.scalars(statement))
        has_more = len(photos) > limit
        return photos[:limit], offset + limit if has_more else None

    def get_photo(self, session: Session, photo_id: str, *, public_only: bool) -> Photo:
        photo = session.get(Photo, photo_id)
        if photo is None or (public_only and photo.visibility != Visibility.PUBLIC.value):
            raise ServiceError(404, "Photo not found.", "photo_not_found")
        return photo

    def set_visibility(self, session: Session, photo_id: str, visibility: Visibility) -> Photo:
        photo = self.get_photo(session, photo_id, public_only=False)
        photo.visibility = visibility.value
        photo.updated_at = utcnow()
        session.commit()
        self.refresh_metrics(session)
        return photo

    def delete_photo(self, session: Session, photo_id: str) -> None:
        photo = self.get_photo(session, photo_id, public_only=False)
        staged = self.storage.stage_photo_delete(photo.id)
        try:
            preview = session.get(PreviewSession, photo.id)
            if preview is not None:
                session.delete(preview)
            session.delete(photo)
            session.commit()
        except Exception:
            session.rollback()
            if staged is not None:
                self.storage.restore_photo(photo.id, staged)
            raise
        self.storage.finalize_delete(staged)
        self.refresh_metrics(session)

    async def reprint(self, session: Session, photo_id: str, idempotency_key: str) -> bool:
        if not idempotency_key or len(idempotency_key) > 64:
            raise ServiceError(400, "A valid Idempotency-Key header is required.", "invalid_key")
        photo = self.get_photo(session, photo_id, public_only=False)
        if photo.last_reprint_key == idempotency_key:
            return True
        if photo.print_status == PrintStatus.REPRINTING.value:
            raise ServiceError(409, "This photo is already being reprinted.", "reprint_in_progress")
        photo.print_status = PrintStatus.REPRINTING.value
        photo.last_reprint_key = idempotency_key
        session.commit()
        try:
            await self.printer.print_prepared(self.storage.read(photo.print_path))
        except PrinterAgentError as exc:
            photo.print_status = (
                PrintStatus.UNCERTAIN.value if exc.ambiguous else PrintStatus.FAILED.value
            )
            if not exc.ambiguous:
                photo.last_reprint_key = None
            session.commit()
            raise ServiceError(503, str(exc), exc.code, retryable=exc.retryable) from exc
        photo.print_status = PrintStatus.PRINTED.value
        photo.last_reprinted_at = utcnow()
        session.commit()
        return False

    def cleanup_expired(self, session: Session) -> int:
        expired = list(
            session.scalars(
                select(PreviewSession).where(
                    PreviewSession.expires_at <= utcnow(),
                    PreviewSession.state.in_([PreviewState.READY.value, PreviewState.FAILED.value]),
                )
            )
        )
        for record in expired:
            self.storage.remove_preview(record.id)
            session.delete(record)
        session.commit()
        return len(expired)

    @staticmethod
    def refresh_metrics(session: Session) -> None:
        PHOTOS.set(session.scalar(select(func.count()).select_from(Photo)) or 0)
        PUBLIC_PHOTOS.set(
            session.scalar(
                select(func.count())
                .select_from(Photo)
                .where(Photo.visibility == Visibility.PUBLIC.value)
            )
            or 0
        )

    def _delete_preview_record(self, session: Session, record: PreviewSession) -> None:
        self.storage.remove_preview(record.id)
        session.delete(record)
        session.commit()
