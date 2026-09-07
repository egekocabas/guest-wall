import { useCallback, useEffect, useRef, useState } from "react";

import { ApiError, api, type Photo } from "./api";

import { PrinterTools } from "./PrinterTools";

const ADMIN_PAGE_SIZE = 12;

export function Admin() {
  const mainRef = useRef<HTMLElement>(null);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (requestedOffset: number) => {
    setLoading(true);
    try {
      let resolvedOffset = requestedOffset;
      let page = await api.listAdminPhotos(resolvedOffset, ADMIN_PAGE_SIZE);

      if (page.items.length === 0 && page.total > 0 && resolvedOffset >= page.total) {
        resolvedOffset = Math.floor((page.total - 1) / ADMIN_PAGE_SIZE) * ADMIN_PAGE_SIZE;
        page = await api.listAdminPhotos(resolvedOffset, ADMIN_PAGE_SIZE);
      }

      setPhotos(page.items);
      setTotal(page.total);
      setOffset(resolvedOffset);
      setNextOffset(page.next_offset);
    } catch (error) {
      setMessage(error instanceof ApiError ? error.message : "Could not load photos.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(0), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function act(action: () => Promise<unknown>, success: string) {
    setMessage("");
    try {
      await action();
      setMessage(success);
      await load(offset);
    } catch (error) {
      setMessage(error instanceof ApiError ? error.message : "That action did not work.");
    }
  }

  function showPage(requestedOffset: number) {
    mainRef.current?.scrollIntoView?.({ block: "start" });
    void load(requestedOffset);
  }

  return (
    <main
      ref={mainRef}
      className="mx-auto min-h-screen max-w-6xl scroll-mt-4 px-4 pb-[max(2rem,env(safe-area-inset-bottom))] pt-5 sm:px-6 sm:pt-8"
    >
      <header className="mb-6 flex items-center justify-between gap-4 border-b border-ink/20 pb-4 sm:mb-8 sm:items-end sm:pb-5">
        <div>
          <p className="font-mono text-xs uppercase tracking-widest text-ink/50">Guestwall</p>
          <h1 className="font-display text-4xl font-black">Admin</h1>
        </div>
        <a href="/" className="tap-link -mr-3 shrink-0 text-sm underline underline-offset-4">
          Back to wall
        </a>
      </header>
      <PrinterTools />
      {message ? (
        <p role="status" className="mb-5 rounded-lg bg-white p-3 text-sm shadow-sm">
          {message}
        </p>
      ) : null}
      {loading ? <p>Loading…</p> : null}
      {!loading ? (
        <p className="mb-4 text-right font-mono text-xs text-ink/50">
          {photos.length} shown / {total} total
        </p>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {photos.map((photo) => (
          <article key={photo.id} className="paper-card p-3 min-[380px]:p-4">
            <img
              src={photo.image_url}
              alt="Thermal Guestwall entry"
              className="aspect-square w-full object-contain grayscale sm:aspect-[4/5]"
            />
            <div className="mt-3 flex flex-wrap justify-between gap-2 font-mono text-xs uppercase text-ink/55">
              <span>{photo.visibility === "public" ? "Public" : "Home only"}</span>
              <span>{photo.print_status}</span>
            </div>
            <div className="mt-4 grid grid-cols-1 gap-2 min-[360px]:grid-cols-2">
              <button
                className="secondary-button text-xs"
                onClick={() =>
                  void act(
                    () =>
                      api.setVisibility(
                        photo.id,
                        photo.visibility === "public" ? "private" : "public",
                      ),
                    "Visibility updated.",
                  )
                }
              >
                Make {photo.visibility === "public" ? "home only" : "public"}
              </button>
              <button
                className="secondary-button text-xs"
                onClick={() => void act(() => api.reprint(photo.id), "Reprint sent.")}
              >
                Reprint
              </button>
              <button
                className="col-span-full min-h-12 rounded-lg border border-red-300 px-4 py-3 text-xs font-bold uppercase tracking-wide text-red-800 transition hover:bg-red-50"
                onClick={() => {
                  if (window.confirm("Delete this photo permanently?"))
                    void act(() => api.deletePhoto(photo.id), "Photo deleted.");
                }}
              >
                Delete
              </button>
            </div>
          </article>
        ))}
      </div>
      {(offset > 0 || nextOffset !== null) && !loading ? (
        <nav
          aria-label="Admin photo pages"
          className="mt-8 flex items-center justify-center gap-2 sm:gap-3"
        >
          <button
            className="secondary-button px-3 disabled:cursor-not-allowed disabled:opacity-40 sm:px-5"
            disabled={offset === 0}
            onClick={() => showPage(Math.max(0, offset - ADMIN_PAGE_SIZE))}
          >
            Previous
          </button>
          <span
            aria-current="page"
            className="min-w-18 text-center font-mono text-xs uppercase tracking-wider text-ink/55"
          >
            Page {Math.floor(offset / ADMIN_PAGE_SIZE) + 1}
          </span>
          <button
            className="secondary-button px-3 disabled:cursor-not-allowed disabled:opacity-40 sm:px-5"
            disabled={nextOffset === null}
            onClick={() => nextOffset !== null && showPage(nextOffset)}
          >
            Next
          </button>
        </nav>
      ) : null}
    </main>
  );
}
