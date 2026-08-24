from datetime import UTC, datetime
from enum import StrEnum

from sqlalchemy import DateTime, String
from sqlalchemy.orm import Mapped, mapped_column

from guestwall.database import Base


def utcnow() -> datetime:
    # SQLite stores naive datetimes; all Guestwall datetimes are explicitly naive UTC.
    return datetime.now(UTC).replace(tzinfo=None)


class Visibility(StrEnum):
    PUBLIC = "public"
    PRIVATE = "private"


class PreviewState(StrEnum):
    READY = "ready"
    PRINTING = "printing"
    PRINTED = "printed"
    FAILED = "failed"
    UNCERTAIN = "uncertain"


class PrintStatus(StrEnum):
    PRINTED = "printed"
    REPRINTING = "reprinting"
    FAILED = "failed"
    UNCERTAIN = "uncertain"


class Photo(Base):
    __tablename__ = "photos"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)
    visibility: Mapped[str] = mapped_column(String(16), index=True)
    preview_path: Mapped[str] = mapped_column(String(255))
    print_path: Mapped[str] = mapped_column(String(255))
    print_status: Mapped[str] = mapped_column(String(16), default=PrintStatus.PRINTED.value)
    printed_at: Mapped[datetime] = mapped_column(DateTime)
    last_reprint_key: Mapped[str | None] = mapped_column(String(64), nullable=True)
    last_reprinted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class PreviewSession(Base):
    __tablename__ = "preview_sessions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    expires_at: Mapped[datetime] = mapped_column(DateTime, index=True)
    state: Mapped[str] = mapped_column(String(16), index=True)
    preview_path: Mapped[str] = mapped_column(String(255))
    print_path: Mapped[str] = mapped_column(String(255))
    photo_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    error_code: Mapped[str | None] = mapped_column(String(64), nullable=True)
