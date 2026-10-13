"""Bound multipart uploads in memory before any image processing or forwarding."""

from collections.abc import AsyncGenerator
from dataclasses import dataclass

from fastapi import Request
from python_multipart.exceptions import MultipartParseError
from starlette.datastructures import UploadFile
from starlette.formparsers import MultiPartException, MultiPartParser

from guestwall.services import ServiceError

MULTIPART_OVERHEAD_BYTES = 65536


@dataclass(frozen=True)
class PhotoUpload:
    image: bytes
    content_type: str
    date: str | None
    time: str | None


async def read_photo_upload(request: Request, limit: int) -> PhotoUpload:
    # Do not use FastAPI's File/Form dependencies: they parse/spool originals
    # before entering the route. The stream limit also covers chunked requests.
    body_limit = limit + MULTIPART_OVERHEAD_BYTES

    async def bounded_stream() -> AsyncGenerator[bytes, None]:
        received = 0
        async for chunk in request.stream():
            received += len(chunk)
            if received > body_limit:
                raise ServiceError(
                    413, "This photo is too large. Choose a smaller one.", "upload_too_large"
                )
            yield chunk

    if (
        request.headers.get("content-type", "").split(";", 1)[0].strip().lower()
        != "multipart/form-data"
    ):
        raise ServiceError(415, "Upload a photo using multipart/form-data.", "invalid_content_type")
    parser = MultiPartParser(
        request.headers, bounded_stream(), max_files=1, max_fields=2, max_part_size=256
    )
    # No accepted request can reach this threshold, so original bytes cannot
    # roll over into a temporary disk file, including before size validation.
    parser.spool_max_size = body_limit + 1
    try:
        form = await parser.parse()
    except (MultiPartException, MultipartParseError) as exc:
        raise ServiceError(400, "Invalid photo upload.", "invalid_upload") from exc
    try:
        names = [name for name, _ in form.multi_items()]
        image = form.get("image")
        date, time = form.get("date"), form.get("time")
        if (
            not isinstance(image, UploadFile)
            or (date is not None and not isinstance(date, str))
            or (time is not None and not isinstance(time, str))
            or len(names) != len(set(names))
            or set(names) - {"image", "date", "time"}
        ):
            raise ServiceError(400, "Choose one photo to continue.", "invalid_upload")
        if image.size is not None and image.size > limit:
            raise ServiceError(
                413, "This photo is too large. Choose a smaller one.", "upload_too_large"
            )
        return PhotoUpload(
            image=await image.read(limit + 1),
            content_type=image.content_type or "application/octet-stream",
            date=date,
            time=time,
        )
    finally:
        await form.close()
