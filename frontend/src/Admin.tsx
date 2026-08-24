import { useCallback, useEffect, useState } from "react";

import { ApiError, api, type Photo } from "./api";

export function Admin() {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setPhotos((await api.listAdminPhotos()).items);
    } catch (error) {
      setMessage(error instanceof ApiError ? error.message : "Could not load photos.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function act(action: () => Promise<unknown>, success: string) {
    setMessage("");
    try {
      await action();
      setMessage(success);
      await load();
    } catch (error) {
      setMessage(error instanceof ApiError ? error.message : "That action did not work.");
    }
  }

  return (
    <main className="mx-auto min-h-screen max-w-6xl px-4 py-8 sm:px-6">
      <header className="mb-8 flex items-end justify-between border-b border-ink/20 pb-5">
        <div>
          <p className="font-mono text-xs uppercase tracking-widest text-ink/50">Guestwall</p>
          <h1 className="font-display text-4xl font-black">Admin</h1>
        </div>
        <a href="/" className="text-sm underline underline-offset-4">
          Back to wall
        </a>
      </header>
      {message ? (
        <p role="status" className="mb-5 rounded-lg bg-white p-3 text-sm shadow-sm">
          {message}
        </p>
      ) : null}
      {loading ? <p>Loading…</p> : null}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {photos.map((photo) => (
          <article key={photo.id} className="paper-card p-4">
            <img
              src={photo.image_url}
              alt="Thermal Guestwall entry"
              className="aspect-[3/4] w-full object-contain grayscale"
            />
            <div className="mt-3 flex justify-between font-mono text-xs uppercase text-ink/55">
              <span>{photo.visibility === "public" ? "Public" : "Home only"}</span>
              <span>{photo.print_status}</span>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2">
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
                className="col-span-2 rounded-lg border border-red-300 px-4 py-3 text-xs font-bold uppercase tracking-wide text-red-800"
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
    </main>
  );
}
