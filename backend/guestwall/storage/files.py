import os
import shutil
from pathlib import Path


class FileStorage:
    def __init__(self, data_dir: Path) -> None:
        self.data_dir = data_dir.resolve()
        self.previews_dir = self.data_dir / "previews"
        self.photos_dir = self.data_dir / "photos"
        self.trash_dir = self.data_dir / ".trash"

    def initialize(self) -> None:
        for path in (self.data_dir, self.previews_dir, self.photos_dir, self.trash_dir):
            path.mkdir(parents=True, exist_ok=True)

    def write_preview(self, preview_id: str, preview: bytes, exact_print: bytes) -> tuple[str, str]:
        directory = self.previews_dir / preview_id
        directory.mkdir(mode=0o700)
        try:
            self._atomic_write(directory / "preview.png", preview)
            self._atomic_write(directory / "print.png", exact_print)
        except Exception:
            shutil.rmtree(directory, ignore_errors=True)
            raise
        return self._relative(directory / "preview.png"), self._relative(directory / "print.png")

    def promote(self, preview_id: str, photo_id: str) -> tuple[str, str]:
        source = self.previews_dir / preview_id
        destination = self.photos_dir / photo_id
        if destination.exists():
            raise FileExistsError(destination)
        source.rename(destination)
        return self._relative(destination / "preview.png"), self._relative(
            destination / "print.png"
        )

    def demote(self, photo_id: str, preview_id: str) -> None:
        source = self.photos_dir / photo_id
        destination = self.previews_dir / preview_id
        if source.exists() and not destination.exists():
            source.rename(destination)

    def read(self, relative_path: str) -> bytes:
        return self.resolve(relative_path).read_bytes()

    def resolve(self, relative_path: str) -> Path:
        candidate = (self.data_dir / relative_path).resolve()
        if self.data_dir not in candidate.parents:
            raise ValueError("path escapes data directory")
        return candidate

    def remove_preview(self, preview_id: str) -> None:
        shutil.rmtree(self.previews_dir / preview_id, ignore_errors=True)

    def remove_photo(self, photo_id: str) -> None:
        shutil.rmtree(self.photos_dir / photo_id, ignore_errors=True)

    def stage_photo_delete(self, photo_id: str) -> Path | None:
        source = self.photos_dir / photo_id
        if not source.exists():
            return None
        staged = self.trash_dir / photo_id
        if staged.exists():
            shutil.rmtree(staged)
        source.rename(staged)
        return staged

    def restore_photo(self, photo_id: str, staged: Path) -> None:
        if staged.exists():
            staged.rename(self.photos_dir / photo_id)

    @staticmethod
    def finalize_delete(staged: Path | None) -> None:
        if staged is not None:
            shutil.rmtree(staged, ignore_errors=True)

    @staticmethod
    def _atomic_write(path: Path, data: bytes) -> None:
        temporary = path.with_suffix(".tmp")
        with temporary.open("xb") as output:
            output.write(data)
            output.flush()
            os.fsync(output.fileno())
        temporary.replace(path)

    def _relative(self, path: Path) -> str:
        return str(path.relative_to(self.data_dir))
