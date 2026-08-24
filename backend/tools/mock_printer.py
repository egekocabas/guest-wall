"""Development-only printer-agent stand-in; it never touches printer hardware."""

import base64

from fastapi import FastAPI, File, UploadFile
from fastapi.responses import Response

app = FastAPI(title="Guestwall development printer mock")

# Small valid monochrome PNG. The real printer-agent remains responsible for preparation.
THERMAL_PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAASwAAAE8AQAAAABRBrPYAAAAAmJLR0QA/4ePzL8AAAAJcEhZcwAACxMAAAsTAQCanBgAAABTSURBVHja7cExAQAAAMKg9U9tCF8gAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAHgNnQABV8CvLQAAAABJRU5ErkJggg=="
)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/preview/image")
async def preview(image: UploadFile = File(...), response: str = "json") -> dict[str, str]:
    await image.read()
    encoded = base64.b64encode(THERMAL_PNG).decode()
    return {"exact_print_image": encoded, "enhanced_preview_image": encoded}


@app.post("/print/prepared-image")
async def print_prepared(image: UploadFile = File(...)) -> Response:
    await image.read()
    return Response(status_code=204)
