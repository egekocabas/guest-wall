from datetime import timedelta
from pathlib import Path

from fastapi.testclient import TestClient
from sqlalchemy import select

from guestwall.config import Settings
from guestwall.main import create_app
from guestwall.models import Photo, PreviewSession, utcnow
from guestwall.printer import PrinterAgentStatus, PrinterHardwareStatus

from .conftest import ENHANCED, EXACT, MockPrinter


def confirm(
    client: TestClient,
    preview_id: str,
    visibility: str = "public",
    *,
    print_photo: bool = True,
):
    return client.post(
        f"/api/previews/{preview_id}/confirm",
        json={"visibility": visibility, "print": print_photo},
    )


def test_printer_status_exposes_generic_hardware_state(
    client: TestClient,
    printer: MockPrinter,
) -> None:
    printer.printer_status = PrinterAgentStatus(
        reachable=True,
        hardware_status=PrinterHardwareStatus.PAPER_OUT,
    )

    assert client.get("/api/printer/status").json() == {
        "online": True,
        "hardware_status": "paper_out",
    }


def test_preview_keeps_only_prepared_outputs(
    client: TestClient,
    create_preview,
    data_dir: Path,
    printer: MockPrinter,
) -> None:
    original = b"unique original phone image with exif and gps"
    preview_id = create_preview(original)
    assert printer.preview_inputs == [original]
    assert client.get(f"/api/previews/{preview_id}/image").content == ENHANCED
    assert (data_dir / "previews" / preview_id / "preview.png").read_bytes() == ENHANCED
    assert (data_dir / "previews" / preview_id / "print.png").read_bytes() == EXACT
    assert not any(
        path.suffix.lower() in {".jpg", ".jpeg", ".heic"} for path in data_dir.rglob("*")
    )
    assert original not in b"".join(
        path.read_bytes() for path in data_dir.rglob("*") if path.is_file()
    )


def test_preview_forwards_optional_caption(client: TestClient, printer: MockPrinter) -> None:
    response = client.post(
        "/api/previews",
        files={"image": ("phone.jpg", b"original", "image/jpeg")},
        data={"date": "24/08/2026", "time": "18:34"},
    )
    assert response.status_code == 201
    assert printer.preview_captions == [("24/08/2026", "18:34")]


def test_preview_rejects_invalid_caption(client: TestClient, printer: MockPrinter) -> None:
    response = client.post(
        "/api/previews",
        files={"image": ("phone.jpg", b"original", "image/jpeg")},
        data={"date": "31/02/2026"},
    )
    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "invalid_caption_date"
    assert printer.preview_inputs == []


def test_confirmation_prints_exact_raster_and_is_idempotent(
    client: TestClient, create_preview, printer: MockPrinter, data_dir: Path
) -> None:
    preview_id = create_preview()
    first = confirm(client, preview_id)
    second = confirm(client, preview_id)
    assert first.status_code == second.status_code == 200
    assert first.json()["id"] == second.json()["id"] == preview_id
    assert second.headers["idempotency-replayed"] == "true"
    assert printer.print_inputs == [EXACT]
    assert (data_dir / "photos" / preview_id / "preview.png").read_bytes() == ENHANCED
    assert (data_dir / "photos" / preview_id / "print.png").read_bytes() == EXACT
    assert not (data_dir / "previews" / preview_id).exists()


def test_wall_only_confirmation_skips_printer_and_is_idempotent(
    client: TestClient, create_preview, printer: MockPrinter, data_dir: Path
) -> None:
    preview_id = create_preview()
    first = confirm(client, preview_id, print_photo=False)
    second = confirm(client, preview_id, print_photo=False)

    assert first.status_code == second.status_code == 200
    assert first.json()["print_status"] == "not_printed"
    assert second.headers["idempotency-replayed"] == "true"
    assert printer.print_inputs == []
    assert (data_dir / "photos" / preview_id / "preview.png").read_bytes() == ENHANCED
    assert (data_dir / "photos" / preview_id / "print.png").read_bytes() == EXACT
    with client.app.state.database.sessions() as session:
        photo = session.get(Photo, preview_id)
        assert photo is not None
        assert photo.printed_at is None

    response = client.post(
        f"/api/admin/photos/{preview_id}/reprint",
        headers={"Idempotency-Key": "first-print-after-wall-only"},
    )
    assert response.status_code == 204
    assert printer.print_inputs == [EXACT]
    with client.app.state.database.sessions() as session:
        photo = session.get(Photo, preview_id)
        assert photo is not None
        assert photo.print_status == "printed"
        assert photo.printed_at is not None


def test_public_boundary_does_not_list_or_serve_private_photo(
    client: TestClient, create_preview
) -> None:
    private_id = create_preview()
    assert confirm(client, private_id, "private").status_code == 200
    public_id = create_preview()
    assert confirm(client, public_id, "public").status_code == 200

    lan_page = client.get("/api/photos").json()
    public_page = client.get("/api/public/photos").json()
    lan = lan_page["items"]
    public = public_page["items"]
    assert {item["id"] for item in lan} == {private_id, public_id}
    assert [item["id"] for item in public] == [public_id]
    assert lan_page["total"] == 2
    assert public_page["total"] == 1
    assert client.get(f"/api/public/photos/{private_id}/image").status_code == 404
    assert client.get(f"/api/public/photos/{public_id}/image").content == ENHANCED


def test_wall_paginates_newest_photos_first(client: TestClient, create_preview) -> None:
    photo_ids = [create_preview(bytes([index])) for index in range(3)]
    for photo_id in photo_ids:
        assert confirm(client, photo_id, print_photo=False).status_code == 200

    base_time = utcnow()
    with client.app.state.database.sessions() as session:
        for index, photo_id in enumerate(photo_ids):
            photo = session.get(Photo, photo_id)
            assert photo is not None
            photo.created_at = base_time + timedelta(seconds=index)
        session.commit()

    first_page = client.get("/api/photos?offset=0&limit=2").json()
    second_page = client.get("/api/photos?offset=2&limit=2").json()

    assert [photo["id"] for photo in first_page["items"]] == photo_ids[::-1][:2]
    assert first_page["next_offset"] == 2
    assert first_page["total"] == 3
    assert [photo["id"] for photo in second_page["items"]] == [photo_ids[0]]
    assert second_page["next_offset"] is None
    assert second_page["total"] == 3


def test_public_host_rejects_lan_and_admin_routes(client: TestClient) -> None:
    headers = {"Host": "public.test"}
    assert client.get("/api/photos", headers=headers).status_code == 404
    assert client.post("/api/previews", headers=headers).status_code == 404
    assert client.get("/api/admin/photos", headers=headers).status_code == 404
    assert client.get("/api/public/photos", headers=headers).status_code == 200


def test_print_failure_does_not_create_photo_and_can_retry(
    client: TestClient, create_preview, printer: MockPrinter
) -> None:
    preview_id = create_preview()
    printer.fail_print = True
    failed = confirm(client, preview_id)
    assert failed.status_code == 503
    assert failed.json()["detail"]["retryable"] is True
    assert client.get("/api/photos").json()["items"] == []
    assert client.get(f"/api/previews/{preview_id}/image").status_code == 200

    printer.fail_print = False
    assert confirm(client, preview_id).status_code == 200
    assert len(printer.print_inputs) == 2


def test_ambiguous_print_is_not_automatically_retryable(
    client: TestClient, create_preview, printer: MockPrinter
) -> None:
    preview_id = create_preview()
    printer.fail_print = True
    printer.ambiguous_print = True
    first = confirm(client, preview_id)
    second = confirm(client, preview_id)
    assert first.status_code == 503
    assert second.status_code == 409
    assert len(printer.print_inputs) == 1
    assert client.get("/api/photos").json()["items"] == []


def test_expired_preview_is_removed(client: TestClient, create_preview, data_dir: Path) -> None:
    preview_id = create_preview()
    database = client.app.state.database
    with database.sessions() as session:
        record = session.get(PreviewSession, preview_id)
        assert record is not None
        record.expires_at = utcnow() - timedelta(seconds=1)
        session.commit()
    response = confirm(client, preview_id)
    assert response.status_code == 410
    assert not (data_dir / "previews" / preview_id).exists()
    with database.sessions() as session:
        assert session.get(PreviewSession, preview_id) is None


def test_admin_visibility_delete_and_reprint_are_safe(
    client: TestClient, create_preview, printer: MockPrinter, data_dir: Path
) -> None:
    photo_id = create_preview()
    assert confirm(client, photo_id, "private").status_code == 200
    changed = client.patch(f"/api/admin/photos/{photo_id}", json={"visibility": "public"})
    assert changed.status_code == 200
    assert client.get(f"/api/public/photos/{photo_id}/image").status_code == 200

    headers = {"Idempotency-Key": "same-admin-operation"}
    assert client.post(f"/api/admin/photos/{photo_id}/reprint", headers=headers).status_code == 204
    assert client.post(f"/api/admin/photos/{photo_id}/reprint", headers=headers).status_code == 204
    assert printer.print_inputs == [EXACT, EXACT]

    assert client.delete(f"/api/admin/photos/{photo_id}").status_code == 204
    assert client.get(f"/api/photos/{photo_id}/image").status_code == 404
    assert not (data_dir / "photos" / photo_id).exists()


def test_database_and_images_survive_application_restart(
    settings: Settings, printer: MockPrinter
) -> None:
    first_app = create_app(settings, printer, auto_create_schema=True)  # type: ignore[arg-type]
    with TestClient(first_app) as first:
        response = first.post(
            "/api/previews", files={"image": ("phone.jpg", b"original", "image/jpeg")}
        )
        photo_id = response.json()["preview_id"]
        assert confirm(first, photo_id).status_code == 200

    second_app = create_app(settings, printer, auto_create_schema=False)  # type: ignore[arg-type]
    with TestClient(second_app) as second:
        photos = second.get("/api/photos").json()["items"]
        assert [photo["id"] for photo in photos] == [photo_id]
        assert second.get(f"/api/photos/{photo_id}/image").content == ENHANCED
        with second.app.state.database.sessions() as session:
            assert session.scalar(select(Photo).where(Photo.id == photo_id)) is not None


def test_delete_abandoned_preview_cleans_files(
    client: TestClient, create_preview, data_dir: Path
) -> None:
    preview_id = create_preview()
    assert client.delete(f"/api/previews/{preview_id}").status_code == 204
    assert not (data_dir / "previews" / preview_id).exists()
    assert client.get(f"/api/previews/{preview_id}/image").status_code == 404
