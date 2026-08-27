# Guestwall

Guestwall is a small, self-hosted photo wall for a home. Guests can choose a photo,
approve a thermal-paper preview, decide whether it is public or home-only, and print it.

The original phone photo is never stored. Guestwall sends it to a separate printer agent
and keeps only the prepared preview and print PNGs returned by that service.

## Highlights

- Mobile-first guest flow with a preview that matches the printed raster.
- Separate LAN, public, and infrastructure-protected admin surfaces.
- Public/private visibility controls enforced by both routing and database queries.
- SQLite and filesystem storage designed for a single self-hosted instance.
- Docker Compose for local use and a Helm chart for Kubernetes deployments.
- Health checks, Prometheus metrics, structured logs, and conservative print retries.

## Architecture

```text
LAN phone --> Guestwall (React + FastAPI) --> SQLite + PNG files
                       |
                       +--> printer-agent --> USB thermal printer

Internet --> restricted public route --> public photos only
```

Guestwall deliberately delegates USB access, image preparation, dithering, and printer-specific
behavior to the independently operated `printer-agent`. See
[Architecture](docs/architecture.md) for the image lifecycle and trust boundaries.

## Quick start

Requirements: Docker with the Compose plugin.

```bash
docker compose up --build
```

Open `http://localhost:8000`. The included mock printer returns a placeholder preview and
acknowledges print requests; it does not emulate thermal processing. Data is stored in the
`guestwall-data` Docker volume.

## Documentation

- [Architecture](docs/architecture.md) — components, privacy boundaries, and print lifecycle.
- [Development](docs/development.md) — local setup, configuration, tests, and checks.
- [Deployment](docs/deployment.md) — container, Helm, K3s, ingress, and network policy setup.
- [Operations](docs/operations.md) — persistence, backup, deletion, observability, and limitations.

## Project status

This is a personal project shared for reference. Issues are open, but support and response times
are not guaranteed. Pull requests are not accepted; see [Contributing](CONTRIBUTING.md).

## License

Guestwall is available under the [MIT License](LICENSE).
