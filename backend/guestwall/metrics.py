from prometheus_client import Counter, Gauge, Histogram

PREVIEW_REQUESTS = Counter("guestwall_preview_requests_total", "Preview requests")
PRINT_REQUESTS = Counter("guestwall_print_requests_total", "Print confirmation requests")
PRINT_FAILURES = Counter("guestwall_print_failures_total", "Failed or uncertain print requests")
PHOTOS = Gauge("guestwall_photos_total", "Persisted Guestwall photos")
PUBLIC_PHOTOS = Gauge("guestwall_public_photos_total", "Public Guestwall photos")
PRINTER_REQUEST_DURATION = Histogram(
    "guestwall_printer_request_duration_seconds",
    "Printer-agent request duration",
    ["operation"],
)
