import os
import tempfile
from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

os.environ.setdefault("DATA_DIR", tempfile.mkdtemp(prefix="guestwall-import-"))

from guestwall.config import Settings  # noqa: E402
from guestwall.main import create_app  # noqa: E402
from guestwall.printer import PreparedImages, PrinterAgentError  # noqa: E402

PNG = b"\x89PNG\r\n\x1a\n"
EXACT = PNG + b"exact-print-raster"
ENHANCED = PNG + b"enhanced-thermal-preview"


class MockPrinter:
    def __init__(self) -> None:
        self.preview_inputs: list[bytes] = []
        self.print_inputs: list[bytes] = []
        self.fail_print = False
        self.ambiguous_print = False

    async def preview(self, image: bytes, content_type: str) -> PreparedImages:
        self.preview_inputs.append(image)
        return PreparedImages(exact_print=EXACT, enhanced_preview=ENHANCED)

    async def print_prepared(self, image: bytes) -> None:
        self.print_inputs.append(image)
        if self.fail_print:
            raise PrinterAgentError(
                "The printer could not print this photo.",
                code="print_failed",
                retryable=True,
                ambiguous=self.ambiguous_print,
            )

    async def healthy(self) -> bool:
        return True


@pytest.fixture
def printer() -> MockPrinter:
    return MockPrinter()


@pytest.fixture
def data_dir(tmp_path: Path) -> Path:
    return tmp_path / "data"


@pytest.fixture
def settings(data_dir: Path) -> Settings:
    return Settings(
        data_dir=data_dir,
        database_url=f"sqlite:///{data_dir / 'test.sqlite3'}",
        public_host="public.test",
        preview_ttl_seconds=3600,
        preview_cleanup_interval_seconds=3600,
    )


@pytest.fixture
def client(settings: Settings, printer: MockPrinter) -> Iterator[TestClient]:
    app = create_app(settings, printer, auto_create_schema=True)  # type: ignore[arg-type]
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture
def create_preview(client: TestClient):
    def create(content: bytes = b"private original bytes") -> str:
        response = client.post(
            "/api/previews",
            files={"image": ("phone.heic", content, "image/heic")},
        )
        assert response.status_code == 201, response.text
        return response.json()["preview_id"]

    return create
