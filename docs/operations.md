# Operations

## Persistent data

```text
/data/guestwall.sqlite3
/data/photos/<photo-id>/preview.png
/data/photos/<photo-id>/print.png
/data/previews/                 # temporary and disposable after expiry
```

Back up `guestwall.sqlite3` and `photos/` together. For a simple consistent backup, stop or scale
down the single deployment, copy the complete `/data` volume, and start it again. Restore the
database and photo tree as a unit.

## Deletion

Admin deletion is a hard delete. The photo directory first moves to an internal trash directory,
the database transaction commits, and only then are the files removed. A database failure restores
the directory. The photo becomes unavailable immediately, and no orphan is intentionally left
behind.

## Health and observability

- `/health/live` reports process health and never depends on the printer.
- `/health/ready` checks SQLite and writable storage, not printer availability.
- `/api/printer/status` performs a low-timeout LAN status check and reports reachability plus
  `ready`, `paper_out`, `error`, or `unknown` hardware state.
- `/metrics` exposes Prometheus counters, gauges, and printer latency without photo-ID labels.
- Logs are structured as one JSON object per line.

Gallery viewing and wall-only contributions continue while the printer agent is offline or the
printer is not ready. Guestwall checks status immediately before printing. Printers without hardware
status support retain reachability-only behavior.

## Limitations

- One replica and one persistent volume only.
- No guest accounts, comments, likes, moderation, cloud object storage, or direct printer control.
- Ambiguous print timeouts require host judgment instead of risking an automatic duplicate.
- Infrastructure Basic Auth is not present in local development; it is a Traefik concern.
