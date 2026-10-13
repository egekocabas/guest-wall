"""Rebuild images from pixels so source metadata never leaves Guestwall."""

import io
import warnings
from collections.abc import Buffer

from PIL import Image, ImageCms, ImageOps, UnidentifiedImageError
from pillow_heif import register_heif_opener  # type: ignore[import-untyped]

register_heif_opener(thumbnails=False)

# MPO is opened by Pillow's JPEG decoder, not a separately registered opener.
UPLOAD_FORMATS = ("JPEG", "PNG", "WEBP", "HEIF", "AVIF")
# At most 2048² RGBA pixels also fit comfortably within printer-agent's
# existing 25 MiB / 50 MP input bounds, even as an uncompressible PNG.
MAX_FORWARD_DIMENSION = 2048


class InvalidImage(ValueError):
    pass


class ImageTooLarge(InvalidImage):
    pass


class _LimitedBuffer(io.BytesIO):
    def __init__(self, limit: int) -> None:
        super().__init__()
        self.limit = limit

    def write(self, data: Buffer, /) -> int:
        if self.tell() + memoryview(data).nbytes > self.limit:
            raise ImageTooLarge("Sanitized image exceeds the upload limit")
        return super().write(data)


def sanitize_image(
    data: bytes,
    *,
    max_pixels: int,
    max_bytes: int,
    prepared: bool = False,
) -> tuple[bytes, str]:
    """Apply upload orientation/color, then encode only pixels into a fresh image.

    Prepared PNGs keep their modes and pixel values, including exact 1-bit print
    rasters. Their metadata must never alter already-approved print pixels.
    """
    try:
        with warnings.catch_warnings():
            # Pillow warns at ~89 MP. The configured limit below is the upload
            # policy, so its warning must not reject valid 89–100 MP photos.
            warnings.simplefilter("ignore", Image.DecompressionBombWarning)
            with Image.open(
                io.BytesIO(data), formats=("PNG",) if prepared else UPLOAD_FORMATS
            ) as image:
                if image.width * image.height > max_pixels:
                    raise ImageTooLarge("Image exceeds the pixel limit")
                if prepared and getattr(image, "is_animated", False):
                    raise InvalidImage("Prepared PNG must contain one frame")
                if not prepared:
                    # The wall/print is a small thermal raster. Reduce the copy
                    # sent downstream, without imposing another upload limit.
                    # JPEG draft decoding can also avoid a full-size buffer.
                    image.thumbnail(
                        (MAX_FORWARD_DIMENSION, MAX_FORWARD_DIMENSION), Image.Resampling.LANCZOS
                    )
                image.load()
                source_format = image.format
                if not prepared:
                    # HEIF preserves the source orientation separately from EXIF.
                    orientation = image.info.get("original_orientation")
                    if image.getexif().get(274, 1) == 1 and orientation in range(2, 9):
                        image.getexif()[274] = orientation
                    ImageOps.exif_transpose(image, in_place=True)
                has_alpha = image.mode in {"RGBA", "LA"} or "transparency" in image.info
                mode = (
                    "RGBA"
                    if has_alpha
                    else (image.mode if image.mode in {"1", "L", "RGB"} else "RGB")
                )
                if mode == "1" and not prepared and source_format != "PNG":
                    mode = "L"
                # A fresh pixel-only image discards EXIF, XMP, ICC, comments,
                # thumbnails, PNG text/private chunks, and appended payloads.
                working = image if image.mode == mode else image.convert(mode)
                if working is not image:
                    image.close()
                with Image.new(mode, working.size) as clean:
                    try:
                        if (
                            not prepared
                            and working.info.get("icc_profile")
                            and mode in {"RGB", "RGBA"}
                        ):
                            try:
                                ImageCms.profileToProfile(
                                    working,
                                    ImageCms.ImageCmsProfile(
                                        io.BytesIO(working.info["icc_profile"])
                                    ),
                                    ImageCms.createProfile("sRGB"),
                                    inPlace=True,
                                )
                            except (OSError, ValueError, ImageCms.PyCMSError):
                                # Invalid profiles are discarded, never forwarded.
                                pass
                        clean.paste(working)
                    finally:
                        working.close()
                    output_format = (
                        "PNG" if prepared or source_format == "PNG" or has_alpha else "JPEG"
                    )
                    with _LimitedBuffer(max_bytes) as output:
                        if output_format == "JPEG":
                            clean.save(output, format="JPEG", quality=95)
                        else:
                            clean.save(output, format="PNG")
                        return output.getvalue(), f"image/{output_format.lower()}"
    except ImageTooLarge:
        raise
    except (Image.DecompressionBombError, Image.DecompressionBombWarning) as exc:
        raise ImageTooLarge("Image exceeds the pixel limit") from exc
    except (UnidentifiedImageError, OSError, ValueError, SyntaxError, EOFError) as exc:
        raise InvalidImage("Image could not be safely decoded") from exc
