# Guestwall

Guestwall started because I wanted to build a memory wall with everyone who visits my home. A guest
can choose an existing photo of us or take one on the spot, add it to the wall, and browse the photo
memories left by previous guests. I also wanted the option to keep a physical copy, so Guestwall is
designed around a thermal printer.

Adding photos, printing, and administration are available only on the home network. Each photo can
be marked **Everyone** or **Home only**. Everyone photos appear in the read-only public gallery
(apparently the whole internet was invited too), while Home only photos remain on the local wall.

The printer interface is [printer-agent](https://github.com/egekocabas/printer-agent), an HTTP
service for ESC/POS thermal printers. Guestwall calls its preview, prepared-image print, and printer
status endpoints and depends on their documented response formats. It is not a generic printer
integration.

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
