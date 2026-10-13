import io
import struct
import tempfile
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from PIL import Image, ImageCms, ImageOps, PngImagePlugin
from PIL.TiffImagePlugin import IFDRational

from guestwall.images import ImageTooLarge, InvalidImage, sanitize_image
from guestwall.printer import PreparedImages

from .conftest import ENHANCED, EXACT, ORIGINAL, MockPrinter
from .image_helpers import image_bytes

PRIVATE_MARKER = b"private-camera-owner-serial"


def private_exif(*, orientation: int = 1) -> Image.Exif:
    exif = Image.Exif()
    exif[274] = orientation
    exif[315] = PRIVATE_MARKER.decode()
    exif[34853] = {
        1: "N",
        2: (IFDRational(52), IFDRational(31), IFDRational(12)),
        3: "E",
        4: (IFDRational(13), IFDRational(24), IFDRational(18)),
    }
    return exif


def private_png(mode: str = "RGB") -> bytes:
    info = PngImagePlugin.PngInfo()
    info.add_text("Comment", PRIVATE_MARKER.decode())
    info.add_text("compressed", PRIVATE_MARKER.decode(), zip=True)
    info.add_itxt("XML:com.adobe.xmp", PRIVATE_MARKER.decode())
    info.add(b"vpAg", PRIVATE_MARKER)
    return (
        image_bytes(
            mode,
            exif=private_exif(),
            pnginfo=info,
            icc_profile=ImageCms.ImageCmsProfile(ImageCms.createProfile("sRGB")).tobytes(),
            dpi=(300, 300),
        )
        + PRIVATE_MARKER
    )


def assert_clean_png(data: bytes) -> None:
    assert data.startswith(b"\x89PNG\r\n\x1a\n")
    offset = 8
    chunks = []
    while offset < len(data):
        size = struct.unpack_from(">I", data, offset)[0]
        name = data[offset + 4 : offset + 8]
        chunks.append(name)
        offset += 12 + size
    assert offset == len(data)
    assert chunks[0] == b"IHDR" and chunks[-1] == b"IEND"
    assert set(chunks) == {b"IHDR", b"IDAT", b"IEND"}
    with Image.open(io.BytesIO(data)) as image:
        assert not image.getexif()
        assert not image.info


def sanitize(data: bytes, *, prepared: bool = False) -> tuple[bytes, str]:
    return sanitize_image(data, max_pixels=1_000_000, max_bytes=2_000_000, prepared=prepared)


@pytest.mark.parametrize("format", ["JPEG", "PNG", "WEBP", "HEIF", "AVIF"])
def test_uploads_strip_exif_gps_and_preserve_orientation(format: str) -> None:
    source = image_bytes(format=format, exif=private_exif(orientation=6))
    with Image.open(io.BytesIO(source)) as image:
        assert image.getexif().get_ifd(34853)
    result, mime = sanitize(source)
    assert PRIVATE_MARKER not in result
    with Image.open(io.BytesIO(result)) as image:
        assert image.size == (16, 24)
        assert not image.getexif()
        assert not set(image.info) & {"exif", "xmp", "icc_profile", "comment"}
    assert mime == ("image/png" if format == "PNG" else "image/jpeg")


@pytest.mark.parametrize("mode", ["1", "L", "RGB", "RGBA"])
def test_prepared_pngs_lose_all_metadata_without_changing_pixels(mode: str) -> None:
    source = private_png(mode)
    result, mime = sanitize(source, prepared=True)
    assert mime == "image/png"
    assert_clean_png(result)
    with Image.open(io.BytesIO(source)) as before, Image.open(io.BytesIO(result)) as after:
        assert (after.mode, after.size, after.tobytes()) == (
            before.mode,
            before.size,
            before.tobytes(),
        )


def test_upload_strips_all_png_metadata_and_keeps_transparency() -> None:
    result, mime = sanitize(private_png("RGBA"))
    assert mime == "image/png"
    assert_clean_png(result)
    with Image.open(io.BytesIO(result)) as image:
        assert image.mode == "RGBA"


def test_palette_transparency_survives_metadata_removal() -> None:
    source = image_bytes("P", transparency=0)
    result, _ = sanitize(source)
    assert_clean_png(result)
    with Image.open(io.BytesIO(source)) as before, Image.open(io.BytesIO(result)) as after:
        assert after.mode == "RGBA"
        assert after.tobytes() == before.convert("RGBA").tobytes()


def test_png_orientation_is_applied_to_pixels_before_discarding_exif() -> None:
    source = image_bytes(exif=private_exif(orientation=6))
    result, _ = sanitize(source)
    with Image.open(io.BytesIO(source)) as before, Image.open(io.BytesIO(result)) as after:
        assert after.tobytes() == ImageOps.exif_transpose(before).tobytes()
    assert_clean_png(result)


@pytest.mark.parametrize("data", [b"not an image", b"\x89PNG\r\n\x1a\n", image_bytes(format="GIF")])
def test_invalid_and_unsupported_images_fail_closed(data: bytes) -> None:
    with pytest.raises(InvalidImage):
        sanitize(data)


def test_pixel_and_encoded_size_limits() -> None:
    with pytest.raises(ImageTooLarge):
        sanitize_image(ORIGINAL, max_pixels=100, max_bytes=2_000_000)
    with pytest.raises(ImageTooLarge):
        sanitize_image(ORIGINAL, max_pixels=1_000_000, max_bytes=10)


def test_prepared_response_must_be_static_png() -> None:
    with pytest.raises(InvalidImage):
        sanitize(image_bytes(format="JPEG"), prepared=True)
    frames = [Image.new("RGB", (2, 2), color) for color in ("red", "blue")]
    output = io.BytesIO()
    frames[0].save(output, format="PNG", save_all=True, append_images=frames[1:])
    with pytest.raises(InvalidImage):
        sanitize(output.getvalue(), prepared=True)


def test_metadata_never_reaches_printer_storage_or_gallery(
    client: TestClient, printer: MockPrinter, data_dir: Path
) -> None:
    printer.prepared = PreparedImages(
        exact_print=private_png("1"), enhanced_preview=private_png("L")
    )
    response = client.post(
        "/api/previews", files={"image": ("private-filename.png", private_png(), "image/png")}
    )
    assert response.status_code == 201, response.text
    photo_id = response.json()["preview_id"]
    assert_clean_png(printer.preview_inputs[0])
    assert printer.preview_content_types == ["image/png"]
    for path in (data_dir / "previews").rglob("*.png"):
        assert_clean_png(path.read_bytes())
    assert_clean_png(client.get(response.json()["preview_url"]).content)
    response = client.post(f"/api/previews/{photo_id}/confirm", json={"visibility": "public"})
    assert response.status_code == 200
    assert printer.print_inputs == [EXACT]
    assert client.get(f"/api/public/photos/{photo_id}/image").content == ENHANCED
    for path in (data_dir / "photos").rglob("*.png"):
        assert_clean_png(path.read_bytes())
    assert not any(
        PRIVATE_MARKER in path.read_bytes() for path in data_dir.rglob("*") if path.is_file()
    )


def test_upload_larger_than_one_mib_never_spools_to_disk(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, printer: MockPrinter
) -> None:
    def no_disk(*_args, **_kwargs):
        pytest.fail("Original upload rolled over to disk")

    monkeypatch.setattr(tempfile.SpooledTemporaryFile, "rollover", no_disk)
    response = client.post(
        "/api/previews",
        files={"image": ("original.png", private_png() + b"x" * (2 * 1024 * 1024), "image/png")},
    )
    assert response.status_code == 201
    assert_clean_png(printer.preview_inputs[0])


@pytest.mark.parametrize("content_length", [None, "1"])
def test_stream_limit_rejects_oversized_upload_without_disk_or_printer(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    printer: MockPrinter,
    content_length: str | None,
) -> None:
    client.app.state.settings.max_upload_bytes = 1024

    def no_disk(*_args, **_kwargs):
        pytest.fail("Original upload rolled over to disk")

    monkeypatch.setattr(tempfile.SpooledTemporaryFile, "rollover", no_disk)
    boundary = "privacy-test"
    start = (
        f'--{boundary}\r\nContent-Disposition: form-data; name="image"; filename="test.png"\r\n'
        "Content-Type: image/png\r\n\r\n"
    ).encode()
    body = start + ORIGINAL + b"x" * 70000 + f"\r\n--{boundary}--\r\n".encode()
    headers = {"content-type": f"multipart/form-data; boundary={boundary}"}
    if content_length is not None:
        headers["content-length"] = content_length
    response = client.post(
        "/api/previews",
        content=(body[i : i + 1024] for i in range(0, len(body), 1024)),
        headers=headers,
    )
    assert response.status_code == 413
    assert printer.preview_inputs == []


def test_invalid_image_is_rejected_before_forwarding(
    client: TestClient, printer: MockPrinter
) -> None:
    response = client.post(
        "/api/previews", files={"image": ("fake.jpg", b"metadata", "image/jpeg")}
    )
    assert response.status_code == 415
    assert printer.preview_inputs == []


def test_upload_validation_rejects_invalid_forms_without_forwarding(
    client: TestClient, printer: MockPrinter
) -> None:
    assert client.post("/api/previews", json={"image": "not a file"}).status_code == 415
    assert (
        client.post(
            "/api/previews", content=b"invalid", headers={"content-type": "multipart/form-data"}
        ).status_code
        == 400
    )
    assert (
        client.post(
            "/api/previews", files={"unexpected": ("photo.png", ORIGINAL, "image/png")}
        ).status_code
        == 400
    )
    assert (
        client.post(
            "/api/previews",
            files=[("image", ("one.png", ORIGINAL)), ("image", ("two.png", ORIGINAL))],
        ).status_code
        == 400
    )
    assert printer.preview_inputs == []


def test_file_limit_is_enforced_within_multipart_overhead_allowance(
    client: TestClient, printer: MockPrinter
) -> None:
    client.app.state.settings.max_upload_bytes = len(ORIGINAL) - 1
    response = client.post("/api/previews", files={"image": ("photo.png", ORIGINAL, "image/png")})
    assert response.status_code == 413
    assert printer.preview_inputs == []


def test_pixel_limit_rejects_before_forwarding(client: TestClient, printer: MockPrinter) -> None:
    client.app.state.settings.max_image_pixels = 100
    response = client.post("/api/previews", files={"image": ("photo.png", ORIGINAL, "image/png")})
    assert response.status_code == 413
    assert printer.preview_inputs == []


@pytest.mark.parametrize("bad_output", ["preview", "print"])
def test_invalid_prepared_image_is_never_saved(
    client: TestClient, printer: MockPrinter, data_dir: Path, bad_output: str
) -> None:
    printer.prepared = PreparedImages(
        enhanced_preview=b"bad" if bad_output == "preview" else ENHANCED,
        exact_print=b"bad" if bad_output == "print" else EXACT,
    )
    response = client.post("/api/previews", files={"image": ("photo.png", ORIGINAL, "image/png")})
    assert response.status_code == 503
    assert response.json()["detail"]["code"] == "invalid_printer_response"
    assert list((data_dir / "previews").iterdir()) == []
