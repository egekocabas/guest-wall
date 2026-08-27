# Development

## Requirements

- Python 3.12 or later.
- Node.js 24.
- npm.

Install dependencies:

```bash
make install
```

Run the mock printer:

```bash
cd backend
../.venv/bin/uvicorn tools.mock_printer:app --port 8001
```

Run the backend and frontend as separate processes:

```bash
make dev-backend
make dev-frontend
```

The Vite server at `http://localhost:5173` proxies `/api` to FastAPI. `PRINTER_AGENT_URL` selects
the real or mock printer agent. The mock returns a placeholder PNG and acknowledges print requests;
it does not run the thermal image pipeline.

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

The container entrypoint runs database migrations. For a direct local run:

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
