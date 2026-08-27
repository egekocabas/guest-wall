# Development

## Requirements

- Python 3.12 or later.
- Node.js 24.
- npm.

Install both application stacks:

```bash
make install
```

Run the development-only printer stand-in:

```bash
cd backend
../.venv/bin/uvicorn tools.mock_printer:app --port 8001
```

In two more terminals, run the backend and frontend:

```bash
make dev-backend
make dev-frontend
```

Open `http://localhost:5173`. Vite proxies `/api` to FastAPI. Set `PRINTER_AGENT_URL` to a real or
mock printer agent as needed. The included mock returns a placeholder PNG and acknowledges prints;
it does not emulate thermal processing.

## Configuration

| Variable                           | Default                 | Purpose                                             |
| ---------------------------------- | ----------------------- | --------------------------------------------------- |
| `DATA_DIR`                         | `/data`                 | SQLite, temporary previews, and permanent photos    |
| `DATABASE_URL`                     | derived from `DATA_DIR` | Optional SQLAlchemy override, mainly for tests      |
| `PRINTER_AGENT_URL`                | `http://localhost:8001` | Backend-only printer-agent base URL                 |
| `PRINTER_TIMEOUT_SECONDS`          | `30`                    | Per-request printer-agent timeout                   |
| `MAX_UPLOAD_BYTES`                 | `20971520`              | Maximum original upload size (20 MiB)               |
| `PREVIEW_TTL_SECONDS`              | `3600`                  | Abandoned preview lifetime                          |
| `PREVIEW_CLEANUP_INTERVAL_SECONDS` | `900`                   | Cleanup loop interval                               |
| `PUBLIC_HOST`                      | deployment-specific     | Host receiving defense-in-depth public restrictions |
| `LOG_LEVEL`                        | `INFO`                  | Structured JSON application log level               |

The backend must be migrated before startup. The container entrypoint does this automatically. For
a direct local run:

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

Backend integration tests cover preview creation, exact raster handling, original-image disposal,
visibility boundaries, pagination, print failures and ambiguity, idempotent confirmations and
reprints, expiry cleanup, admin changes and deletion, and restart persistence. Frontend tests cover
the public boundary, bounded page navigation, mobile loading, and the main guest flow.

CI runs formatting, linting, strict type checking, tests, the production frontend build, Helm lint
and rendering, and a multi-platform container build. Main and version tags publish `linux/amd64`
and `linux/arm64` images to GHCR.
