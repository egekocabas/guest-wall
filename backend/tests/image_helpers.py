import io
from typing import Any

from PIL import Image


def image_bytes(mode: str = "RGB", *, format: str = "PNG", **options: Any) -> bytes:
    image = Image.new(mode, (24, 16), 1 if mode == "1" else 120)
    image.putpixel((0, 0), 0)
    output = io.BytesIO()
    image.save(output, format=format, **options)
    return output.getvalue()
