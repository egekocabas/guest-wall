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

Guestwall bounds the upload, sends it to `printer-agent`, and stores `preview.png` and `print.png`
under `/data/previews/<uuid>/`. The original photo, including EXIF and GPS metadata, is never
written to persistent storage. Temporary files and abandoned previews are cleaned up.

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
