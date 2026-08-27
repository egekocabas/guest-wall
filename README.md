# Guestwall

Guestwall is a self-hosted photo wall designed to work with a thermal printer. A guest chooses a
photo, reviews the prepared thermal preview, selects public or home-only visibility, and can print
the approved image.

The printer interface is [printer-agent](https://github.com/egekocabas/printer-agent), an HTTP
service for ESC/POS thermal printers. Guestwall calls its preview, prepared-image print, and printer
status endpoints and depends on their documented response formats. It is not a generic printer
integration.

The original upload is transient. Guestwall stores only the preview and print PNGs returned by
`printer-agent`.

## Behavior

- The approved raster is sent back to `printer-agent` without another image-processing pass.
- LAN, public, and admin routes expose different application and API surfaces.
- Visibility is checked in database queries and again when images are served.
- SQLite and generated PNG files share one persistent volume; the application runs as one replica.
- The repository includes Docker Compose configuration and a Helm chart for Kubernetes.
- The backend exposes health endpoints, Prometheus metrics, and structured JSON logs.

## Architecture

```text
LAN phone --> Guestwall (React + FastAPI) --> SQLite + PNG files
                       |
                       +--> printer-agent --> USB thermal printer

Internet --> restricted public route --> public photos only
```

`printer-agent` handles USB access, input conversion, resizing, dithering, and printer status.
Guestwall handles the guest flow, visibility, persistence, and the public and admin boundaries. See
[Architecture](docs/architecture.md) for the component contract and image lifecycle.

## Quick start

```bash
docker compose up --build
```

The application is served at `http://localhost:8000`. The Compose stack uses the included mock
printer, which returns a placeholder preview and acknowledges print requests. Data is stored in the
`guestwall-data` volume.

## Documentation

- [Architecture](docs/architecture.md) — components, privacy boundaries, and print lifecycle.
- [Development](docs/development.md) — local setup, configuration, tests, and checks.
- [Deployment](docs/deployment.md) — container, Helm, Kubernetes, ingress, and network policy.
- [Operations](docs/operations.md) — persistence, backup, deletion, observability, and limitations.

## Project status

This is a personal project shared for reference. Issues are open, but support and response times
are not guaranteed. Pull requests are not accepted; see [Contributing](CONTRIBUTING.md).

## License

Guestwall is available under the [MIT License](LICENSE).
