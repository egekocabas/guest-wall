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

## Image lifecycle

After a guest chooses a photo, the browser sends it to `POST /api/previews` without a caption and
shows the printer-generated preview. The selected `File` stays only in that browser tab while the
flow is active. Date, time, and mirrored variants create additional temporary previews. Generated
variants are cached in the tab, and mirroring happens before thermal preparation so captions remain
readable.

Each preview request keeps the bounded upload in request-scoped multipart storage. Larger uploads
may spool only to the pod's ephemeral `/tmp`. Guestwall sends the image to `printer-agent` and
writes only the returned files under `/data/previews/<uuid>/`:

- `preview.png` is the screen-friendly thermal representation shown on the wall.
- `print.png` is the exact prepared raster approved in the preview and sent to the printer.

The original phone photo, including EXIF and GPS metadata, is never written to persistent storage.
Request cleanup removes spool files, while cancellation, expiry, startup cleanup, and the cleanup
loop remove abandoned previews.

Confirming a preview promotes its directory to `/data/photos/<uuid>/` and creates a permanent
photo. The operation atomically claims `ready` or `failed`, so only one request can finalize a
preview. Repeating a successful confirmation returns the existing photo without printing again.
Unused preview variants are deleted.

Guests may print and add a photo or add it to the wall without printing. Wall-only photos use
`print_status=not_printed` and can be printed later from Admin. A definite print failure may be
retried. A timeout or another ambiguous transport failure becomes `uncertain` and is not
automatically retryable because the printer may have completed the job after the response was lost.
Admin reprints require an `Idempotency-Key`; replaying the same key never creates a second reprint.

## Access boundaries

- **LAN:** full gallery, private images, uploads, previews, printing, and admin routes.
- **Public:** `/`, static assets, health endpoints, and `/api/public/*` only.
- **Admin:** `/admin*` and `/api/admin*`, protected by a higher-priority Traefik route with Basic
  Auth backed by an existing Kubernetes Secret or middleware.

The public query filters visibility in SQL, and the public image handler checks it again. The Helm
public Ingress uses an explicit path allowlist instead of a catch-all prefix. FastAPI additionally
returns 404 for non-public paths when the request host matches `PUBLIC_HOST`. Private images are
served only through API handlers and cannot be reached through guessed static URLs.

Gallery queries use stable newest-first ordering and return 12 photos per page. Previous and next
navigation replace the current page instead of growing the DOM indefinitely. Responses include the
filtered total so the wall can show both visible and collection counts.
