# Operations

## Persistent data

```text
/data/guestwall.sqlite3
/data/photos/<photo-id>/preview.png
/data/photos/<photo-id>/print.png
/data/previews/ # temporary and disposable after expiry
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
- Infrastructure Basic Auth is not present in local development; it is a Traefik concern.

## Admin printer tools

The Admin page offers printer status/refresh, paper feed presets (1, 3, 5 lines) and a custom
1–255 line count, plus separate home/public QR print actions with editable optional labels.
These jobs do not create gallery photos. Feed advances exactly the requested number of lines;
QR jobs use printer-agent's configured final tear-off spacing.

Set `HOME_URL` and `PUBLIC_URL` to absolute HTTP(S) website URLs (including scheme and any port).
In Helm, use `app.homeUrl` and `app.publicUrl`. Unconfigured destinations are disabled. URLs are
selected by the backend, not supplied by the browser; print the home root URL for uploads and the
full wall, and the public root URL for the public gallery. The home QR requires home network access.
Changing a ConfigMap used for environment variables requires a pod restart or image rollout.

All new endpoints are under `/api/admin/printer/`: `GET status`, `GET links`, `POST feed`
(`{"lines":3}`), and `POST qr` (`{"destination":"home","label":"Welcome"}`). They inherit the
LAN admin ingress's Basic Auth. The public ingress does not route them, and FastAPI returns 404
on `PUBLIC_HOST`. The existing read-only `/api/public/*` gallery remains public. Do not expose
the application Service or printer-agent directly through a public tunnel.

Print controls are disabled while a job is pending or the printer reports a problem. Every job
checks printer readiness on the backend. Requests are never automatically retried: after an
uncertain result, check the physical paper before explicitly sending another job.

Admin also polls printer status every 15 seconds while the tab is visible and refreshes when the
tab becomes visible again. Polling pauses during printer actions, skips overlapping status requests,
and stops when Admin unmounts. Background polls only fetch status, not QR configuration. This uses
printer-agent's existing status endpoint unchanged; cached USB connections may still report stale
reachability after a power change, and hardware/paper status depends on what the agent reports.
