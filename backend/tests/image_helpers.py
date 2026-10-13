import io
from typing import Any

from PIL import Image


def image_bytes(
    mode: str = "RGB", *, format: str = "PNG", size: tuple[int, int] = (24, 16), **options: Any
) -> bytes:
    with Image.new(mode, size, 1 if mode == "1" else 120) as image, io.BytesIO() as output:
        image.putpixel((0, 0), 0)
        image.save(output, format=format, **options)
        return output.getvalue()
