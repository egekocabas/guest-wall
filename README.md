# Guestwall

Guestwall is a small, self-hosted photo wall for a home. A guest on the LAN chooses or takes a photo, approves a thermal-paper preview, chooses **Everyone** or **Home only**, and prints it. The public site is a separate, read-only view containing only explicitly public photos.

Guestwall does **not** know about USB, ESC/POS, HEIC conversion, printer width, dithering, or thermal image preparation. It sends the transient original to an independently operated `printer-agent`, then stores only the two PNGs returned by that service:

- `preview.png`: the screen-friendly thermal representation shown on the wall.
- `print.png`: the exact prepared raster approved in the preview and sent unchanged to the printer.

The original phone photo, including its EXIF/GPS data, is never written to Guestwall storage.

## Architecture

```text
LAN phone ──> Guestwall (React + FastAPI, one K3s pod)
                    │
                    ├── SQLite + PNG files on one PVC
                    │
                    └── HTTP ──> printer-agent on the Pi host ──> USB printer

Internet ──> public Traefik route ──> / + assets + /api/public/* only
```

The single container builds the Vite application and serves it from FastAPI. SQLite runs in WAL mode with a busy timeout. The deployment strategy is `Recreate` and `replicaCount` must remain `1`: SQLite and the filesystem are deliberately local, and Guestwall is not horizontally scalable.

### Preview and print state

`POST /api/previews` keeps the bounded original in request-scoped multipart storage (memory, with larger files spooled only to the pod's ephemeral `/tmp`), sends it to `printer-agent`, and writes only the two returned PNGs under `/data/previews/<uuid>/`. Guests can optionally add their browser's current date or date and time as a caption; Guestwall forwards those fields while preparing the image, so the caption is part of both returned PNGs. The original is never written to `/data`; request cleanup removes any spool file, and Kubernetes mounts `/tmp` as a size-limited `emptyDir`. Preview rows expire after one hour by default; startup, opportunistic access, and a small in-process cleanup loop remove abandoned previews.

Confirmation atomically claims `ready`/`failed` as `printing`. Only one request can print it. A successful printer response promotes the directory to `/data/photos/<uuid>/` and creates a permanent `Photo`. Repeating the confirmation returns the existing photo without printing again. A definite failure may be retried. A timeout or other ambiguous transport failure becomes `uncertain` and is deliberately not retryable, because the printer may already have printed after the response was lost. This conservative edge case requires the host to inspect the printer.

Admin reprints require an `Idempotency-Key`; repeating the same key never produces a second reprint.

## LAN, public, and admin boundaries

- LAN host: full gallery, private images, uploads, previewing, printing, and admin routes.
- Public host: only `/`, static assets, health endpoints, and `/api/public/*`. The public query filters in SQL, and the public image handler rechecks visibility.
- Admin: `/admin*` and `/api/admin*` are a separate, higher-priority Traefik route with an existing Basic Auth middleware. Guestwall intentionally has no user database.

The Helm public `Ingress` has an explicit list of `Exact`/`Prefix` paths rather than a catch-all `/` prefix. The backend additionally returns 404 for all non-public paths when the request host equals `PUBLIC_HOST`. Private images are never mounted as static files, so no guessed public URL can bypass the API.

## Local development

Requirements: Python 3.12+, Node.js 24, and npm.

```bash
make install
```

Run the included development-only printer stand-in:

```bash
cd backend
../.venv/bin/uvicorn tools.mock_printer:app --port 8001
```

In two more terminals:

```bash
make dev-backend
make dev-frontend
```

Open `http://localhost:5173`. Vite proxies `/api` to FastAPI. Point `PRINTER_AGENT_URL` at a real or mock printer-agent as needed. The included mock only returns a placeholder PNG and acknowledges prints; it does not emulate thermal processing.

Alternatively, the production-shaped stack is one command:

```bash
docker compose up --build
```

Then open `http://localhost:8000`. Data is kept in the `guestwall-data` Docker volume.

### Backend environment

| Variable | Default | Purpose |
| --- | --- | --- |
| `DATA_DIR` | `/data` | SQLite, previews, and permanent photos |
| `DATABASE_URL` | derived from `DATA_DIR` | Optional SQLAlchemy override, mainly for tests |
| `PRINTER_AGENT_URL` | `http://localhost:8001` | Internal backend-only printer-agent base URL |
| `PRINTER_TIMEOUT_SECONDS` | `30` | Per-request printer-agent timeout |
| `MAX_UPLOAD_BYTES` | `20971520` | Maximum original upload size (20 MiB) |
| `PREVIEW_TTL_SECONDS` | `3600` | Abandoned preview lifetime |
| `PREVIEW_CLEANUP_INTERVAL_SECONDS` | `900` | Cleanup loop interval |
| `PUBLIC_HOST` | `guest-wall.egekocabas.com` | Host receiving defense-in-depth public restrictions |
| `LOG_LEVEL` | `INFO` | Structured JSON application log level |

The backend must be migrated before it starts. The container entrypoint does this automatically. For a direct local run:

```bash
cd backend
DATA_DIR=./data ../.venv/bin/alembic upgrade head
DATA_DIR=./data ../.venv/bin/uvicorn guestwall.main:app --reload
```

## Tests and checks

```bash
make test
make lint
cd frontend && npm run build
helm lint chart/guest-wall
docker build -t guestwall:local .
```

Backend integration tests use a mocked client and cover preview creation, exact raster handling, no original persistence, visibility boundaries, print failure and ambiguity, idempotent confirmation/reprints, expiry cleanup, admin changes/deletion, and restart persistence. Frontend tests cover the public-only boundary and the primary guest flow.

CI runs formatting, linting, strict type checking, tests, the production frontend build, Helm lint/render, and a container build. Main and version tags publish multi-platform `linux/amd64` and `linux/arm64` images to GHCR.

## K3s / Helm deployment

The chart follows the homelab's standard `networking.k8s.io/v1` Ingress pattern and expects an existing Traefik Basic Auth `Middleware`. It never creates or embeds credentials. A minimal environment values file looks like:

```yaml
image:
  repository: ghcr.io/egekocabas/guest-wall
  tag: main
  digest: sha256:replace-with-published-multiarch-index-digest

printerAgent:
  url: http://192.168.178.100:8001

app:
  publicHost: guest-wall.egekocabas.com

ingress:
  lan:
    enabled: true
    host: guest-wall.home.egekocabas.com
  public:
    enabled: true
    host: guest-wall.egekocabas.com

admin:
  basicAuthMiddleware: observability-observability-ui-auth@kubernetescrd

networkPolicy:
  enabled: true
  printerAgent:
    enabled: true
    cidr: 192.168.178.100/32
    port: 8001

serviceMonitor:
  enabled: true
```

Install or let Argo CD reconcile it:

```bash
helm upgrade --install guest-wall chart/guest-wall \
  --namespace guest-wall --create-namespace \
  --values values.home.yaml
```

Operator configuration still required:

1. Publish an ARM64-capable image and set its repository/tag.
2. Set a printer-agent URL reachable from the K3s pod. The browser never receives this URL.
3. Configure LAN DNS, the Cloudflare Tunnel public hostname, and the existing Traefik Basic Auth middleware provider reference (`namespace-name@kubernetescrd`). The LAN Ingress uses the homelab wildcard TLS setup; the public Tunnel Ingress intentionally has no LAN TLS annotations.
4. Keep one replica and select the desired `local-path` storage size/class.
5. Restrict the printer-agent at the network/host firewall layer to trusted callers.

The default ingresses are disabled so `helm lint` is safe and the example hostnames cannot accidentally be deployed. Enabling LAN ingress without a full Basic Auth middleware reference fails template rendering. `NetworkPolicy` is also opt-in because its printer-agent CIDR must be configured correctly; the reference homelab values enable it.

## Data, deletion, and backup

Persistent state is:

```text
/data/guestwall.sqlite3
/data/photos/<photo-id>/preview.png
/data/photos/<photo-id>/print.png
/data/previews/                 # temporary, disposable after expiry
```

Admin deletion is a hard delete. The photo directory is first moved to an internal trash directory, the database transaction is committed, and only then are its files removed; a database failure restores the directory. The photo becomes unavailable immediately and no orphan is intentionally left behind.

Back up `guestwall.sqlite3` and `photos/` together. For a simple consistent backup, briefly stop/scale down the single deployment, copy the whole `/data` PVC, then start it again. Restore both the database and photo tree as a unit.

## Operations

- `/health/live` reports process health and never depends on the printer.
- `/health/ready` checks SQLite and writable storage, not printer availability.
- `/api/printer/status` is a low-timeout LAN status check used by the contribution UI.
- `/metrics` exposes Prometheus counters, gauges, and printer request latency without photo-ID labels.
- Logs are one JSON object per line for collection by Grafana Alloy.

Gallery viewing continues when the printer-agent or printer is offline. No failed print is added to the wall.

## v1 limitations

- One replica and one persistent volume only.
- No guest accounts, comments, likes, moderation, cloud object storage, or direct printer control.
- Ambiguous print timeouts intentionally require host judgment instead of risking an automatic duplicate.
- Infrastructure Basic Auth is not present in local development; it is exclusively a Traefik concern.
