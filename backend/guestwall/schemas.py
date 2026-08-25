from datetime import datetime

from pydantic import BaseModel, ConfigDict

from guestwall.models import Visibility
from guestwall.printer import PrinterHardwareStatus


class PreviewCreated(BaseModel):
    preview_id: str
    preview_url: str
    expires_at: datetime


class ConfirmPreview(BaseModel):
    visibility: Visibility
    print: bool = True


class PhotoView(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    created_at: datetime
    visibility: Visibility
    print_status: str
    image_url: str


class PhotoPage(BaseModel):
    items: list[PhotoView]
    next_offset: int | None
    total: int


class VisibilityUpdate(BaseModel):
    visibility: Visibility


class PrinterStatus(BaseModel):
    online: bool
    hardware_status: PrinterHardwareStatus | None


class ErrorDetail(BaseModel):
    message: str
    code: str
    retryable: bool = False
