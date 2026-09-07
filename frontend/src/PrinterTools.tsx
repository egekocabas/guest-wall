import { useCallback, useEffect, useRef, useState } from "react";

import { api, ApiError, type PrinterLinks, type PrinterStatus } from "./api";

export function PrinterTools() {
  const [status, setStatus] = useState<PrinterStatus | null>(null);
  const [links, setLinks] = useState<PrinterLinks | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [message, setMessage] = useState("");
  const [lines, setLines] = useState("3");
  const [homeLabel, setHomeLabel] = useState("Add your photo to Guestwall - connect to home Wi-Fi");
  const [publicLabel, setPublicLabel] = useState("View our Guestwall");

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const [nextStatus, nextLinks] = await Promise.all([
        api.adminPrinterStatus(),
        api.printerLinks(),
      ]);
      setStatus(nextStatus);
      setLinks(nextLinks);
    } catch {
      setStatus(null);
      setMessage((current) => current || "Could not check the printer. Refresh to try again.");
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  const ready = status?.online && (!status.hardware_status || status.hardware_status === "ready");
  const disabled = busy || refreshing || !ready;
  const count = Number(lines);
  const validLines = lines.trim() !== "" && Number.isInteger(count) && count >= 1 && count <= 255;
  const statusLabel = !status
    ? "Not checked"
    : !status.online
      ? "Offline"
      : status.hardware_status === "paper_out"
        ? "Out of paper"
        : status.hardware_status === "error"
          ? "Needs attention"
          : status.hardware_status === "unknown"
            ? "Not ready"
            : "Ready";

  async function run(action: () => Promise<void>, success: string) {
    if (inFlight.current || disabled) return;
    inFlight.current = true;
    setBusy(true);
    setMessage("");
    try {
      await action();
      setMessage(success);
    } catch (error) {
      setMessage(
        error instanceof ApiError
          ? error.message
          : "The print outcome is unknown. Check the paper before sending another job.",
      );
    } finally {
      await refresh();
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="printer-tools-title" className="paper-card mb-8 p-4 sm:p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="printer-tools-title" className="font-display text-2xl font-bold">
            Printer tools
          </h2>
          <p className="mt-1 text-sm text-ink/60">
            Printer: {refreshing ? "Checking…" : statusLabel}
          </p>
        </div>
        <button
          className="secondary-button text-xs"
          disabled={refreshing || busy}
          onClick={() => {
            setMessage("");
            void refresh();
          }}
        >
          Refresh printer
        </button>
      </div>
      <fieldset
        disabled={disabled}
        className="mb-6 border-b border-ink/20 pb-5 disabled:opacity-50"
      >
        <legend className="mb-2 font-bold">Feed paper</legend>
        <div className="flex flex-wrap items-end gap-2">
          {[1, 3, 5].map((value) => (
            <button
              key={value}
              className="secondary-button text-xs"
              onClick={() =>
                void run(
                  () => api.feedPaper(value),
                  `Fed ${value} blank ${value === 1 ? "line" : "lines"}.`,
                )
              }
            >
              {value} {value === 1 ? "line" : "lines"}
            </button>
          ))}
          <label className="flex flex-col gap-1 text-sm">
            Custom lines
            <input
              type="number"
              min="1"
              max="255"
              step="1"
              value={lines}
              onChange={(event) => setLines(event.target.value)}
              className="min-h-12 w-24 rounded-lg border border-ink/20 bg-white px-3"
            />
          </label>
          <button
            className="secondary-button text-xs"
            disabled={!validLines}
            onClick={() => void run(() => api.feedPaper(count), `Fed ${count} blank lines.`)}
          >
            Feed paper
          </button>
        </div>
        <p className="mt-2 text-xs text-ink/60">
          Advance 1–255 blank lines, with no extra spacing.
        </p>
      </fieldset>
      <div className="grid gap-6 sm:grid-cols-2">
        {(["home", "public"] as const).map((destination) => {
          const home = destination === "home";
          const url = home ? links?.home_url : links?.public_url;
          return (
            <div key={destination}>
              <h3 className="font-bold">{home ? "Home wall" : "Public wall"}</h3>
              <p className="mt-1 text-sm text-ink/60">
                {home
                  ? "Add photos and view the full wall on home Wi-Fi."
                  : "View photos shared publicly."}
              </p>
              <p className="my-3 break-all font-mono text-xs">
                {url || "Wall URL has not been configured."}
              </p>
              <label className="flex flex-col gap-1 text-sm">
                {home ? "Home QR label (optional)" : "Public QR label (optional)"}
                <input
                  maxLength={200}
                  value={home ? homeLabel : publicLabel}
                  onChange={(event) =>
                    home ? setHomeLabel(event.target.value) : setPublicLabel(event.target.value)
                  }
                  className="min-h-12 w-full rounded-lg border border-ink/20 bg-white px-3"
                />
              </label>
              <button
                className="secondary-button mt-3 w-full text-xs"
                disabled={disabled || !url}
                onClick={() =>
                  void run(
                    () => api.printWallQr(destination, home ? homeLabel : publicLabel),
                    `${home ? "Home" : "Public"} QR printed.`,
                  )
                }
              >
                Print {destination} QR
              </button>
            </div>
          );
        })}
      </div>
      {busy ? (
        <p className="mt-4 text-sm" role="status">
          Sending printer job…
        </p>
      ) : null}
      {message ? (
        <p className="mt-4 text-sm" role="status">
          {message}
        </p>
      ) : null}
    </section>
  );
}
