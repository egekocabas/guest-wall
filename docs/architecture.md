# Architecture

Guestwall is a single-container React and FastAPI application. The container serves the Vite
build, API, health checks, and metrics. SQLite and generated PNGs share one persistent volume.

```text
LAN phone --> Guestwall (React + FastAPI, one pod)
                    |
                    +--> SQLite + PNG files on one volume
                    |
                    +--> HTTP --> printer-agent --> USB printer

Internet --> restricted public route --> / + assets + /api/public/*
```

SQLite runs in WAL mode with a busy timeout. The Kubernetes deployment uses the `Recreate`
strategy and exactly one replica because the database and filesystem are intentionally local.
Guestwall is not horizontally scalable.

## Printer-agent contract

Guestwall integrates specifically with
[`printer-agent`](https://github.com/egekocabas/printer-agent). A replacement service would need to
implement the same HTTP contract:

- `POST /preview/image?response=json` accepts a multipart `image` plus optional `date` and `time`
  fields. Guestwall expects Base64-encoded PNG values named `exact_print_image` and
  `enhanced_preview_image`.
- `POST /print/prepared-image` accepts the approved 1-bit PNG as multipart `image`. Guestwall treats
  a successful HTTP response as confirmation that the request completed.
- `GET /printer/status` returns an object with `reachable` and optional `hardware_status` fields.
  Recognized hardware states are `ready`, `paper_out`, `error`, and `unknown`.

The upstream endpoint definitions and validation rules are documented in the
[`printer-agent` HTTP API](https://github.com/egekocabas/printer-agent/blob/main/docs/api.md).

## Image lifecycle

The browser sends the selected file to `POST /api/previews` and keeps it in the active tab. Date,
time, and mirrored variants are prepared separately and cached in the browser.

Guestwall parses uploads in bounded memory without temporary-file rollover. The byte limit is
enforced while reading the request, including requests without a truthful `Content-Length`.
Original bytes exist only in request memory; they are not written to application storage or sent
to `printer-agent`.

Before forwarding, Guestwall decodes the image, applies orientation and valid color profiles, and
rebuilds it from pixels. The forwarded copy is reduced proportionally to at most 2048 pixels per
side, without upscaling, so even large uploads fit printer-agent's existing 25 MiB / 50 MP input
bounds. This remains well above the thermal printer's resolution; prepared print pixels are not
resized. PNG uploads and transparent images become PNG; other photos become quality-95 JPEG.
Only the first frame is used. Source EXIF/GPS, XMP, ICC, comments, thumbnails,
private chunks, and trailing data are discarded. This normalization may re-encode lossy photos;
it does not add source capture dates to the user-selected caption.

Guestwall also rebuilds both returned PNGs before storing `preview.png` and `print.png` under
`/data/previews/<uuid>/`. Exact monochrome print pixels remain unchanged. Invalid or oversized
images fail before forwarding or storage, rather than falling back to the original bytes.
The defaults are 50 MiB for each uploaded/encoded image and 100 million decoded pixels, allowing
48 MP phone photos with room for larger images. These are resource bounds for the home-network
upload flow. Image work runs off the event loop and avoids unnecessary full-resolution copies.
The Helm chart allows 2 GiB of container memory for large-photo decoding. Deployments with a custom
memory limit should allow comparable headroom; increasing upload limits alone does not increase
available process memory.

This protects newly created previews and photos; it does not rewrite older stored files. Browser
memory still contains the selected original until the guest resets the flow or closes the tab.
Abandoned sanitized previews are cleaned up. Any upstream proxy buffering, host swap, or backups
are deployment concerns outside the application's in-memory upload guarantee.

Confirmation atomically promotes the selected preview to `/data/photos/<uuid>/` and creates the
photo record. Repeated confirmations return the same photo, and unused variants are deleted. Photos
added without printing use `print_status=not_printed` and can be printed later from Admin.

## Access boundaries

- **LAN:** full gallery, private images, uploads, previews, printing, and admin routes.
- **Public:** `/`, static assets, health endpoints, and `/api/public/*` only.
- **Admin:** `/admin*` and `/api/admin*`, protected by a higher-priority Traefik route with Basic
  Auth backed by an existing Kubernetes Secret or middleware.

Public visibility is enforced in SQL and during image lookup. The public Ingress exposes an explicit
path allowlist, and FastAPI rejects other paths on `PUBLIC_HOST`. Private images have no static
route.

Gallery pages are newest-first, contain up to 12 photos, and replace the current page during
navigation.
