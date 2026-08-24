import { useCallback, useEffect, useState } from "react";

import { api, type Photo } from "./api";

interface GalleryProps {
  publicOnly?: boolean;
  refreshToken?: number;
}

export function Gallery({ publicOnly = false, refreshToken = 0 }: GalleryProps) {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(
    async (offset: number, replace = false) => {
      setLoading(true);
      setError("");
      try {
        const page = await api.listPhotos(publicOnly, offset);
        setPhotos((current) => (replace ? page.items : [...current, ...page.items]));
        setNextOffset(page.next_offset);
      } catch {
        setError("The wall couldn’t be loaded right now.");
      } finally {
        setLoading(false);
      }
    },
    [publicOnly],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => void load(0, true), 0);
    return () => window.clearTimeout(timer);
  }, [load, refreshToken]);

  return (
    <section aria-labelledby="wall-title" className="mx-auto w-full max-w-6xl px-4 pb-16 sm:px-6">
      <div className="mb-6 flex items-end justify-between border-b border-ink/15 pb-3">
        <div>
          <p className="font-mono text-[0.65rem] uppercase tracking-[0.24em] text-ink/50">
            Collected moments
          </p>
          <h2 id="wall-title" className="font-display text-3xl font-bold tracking-tight">
            The wall
          </h2>
        </div>
        <span className="font-mono text-xs text-ink/45">{photos.length} shown</span>
      </div>

      {!loading && photos.length === 0 && !error ? (
        <div className="paper-card py-16 text-center">
          <p className="font-display text-2xl">The wall is waiting.</p>
          <p className="mt-2 text-sm text-ink/55">The first little memory can be yours.</p>
        </div>
      ) : null}
      {error ? <p className="rounded-xl bg-red-50 p-4 text-sm text-red-800">{error}</p> : null}

      <div className="columns-2 gap-3 sm:columns-3 sm:gap-5 lg:columns-4">
        {photos.map((photo, index) => (
          <figure
            key={photo.id}
            className="paper-photo mb-3 break-inside-avoid sm:mb-5"
            style={{ rotate: `${((index % 5) - 2) * 0.35}deg` }}
          >
            <img
              src={photo.image_url}
              alt="A thermal Guestwall memory"
              loading="lazy"
              className="h-auto w-full grayscale"
            />
            <figcaption className="mt-2 flex items-center justify-between font-mono text-[0.6rem] uppercase tracking-wider text-ink/45">
              <time dateTime={photo.created_at}>
                {new Intl.DateTimeFormat(undefined, {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                }).format(new Date(photo.created_at))}
              </time>
              {!publicOnly && photo.visibility === "private" ? <span>home</span> : null}
            </figcaption>
          </figure>
        ))}
      </div>

      {loading ? (
        <p className="py-8 text-center font-mono text-xs uppercase tracking-widest text-ink/50">
          Loading wall…
        </p>
      ) : null}
      {nextOffset !== null && !loading ? (
        <button
          className="secondary-button mx-auto mt-8 block"
          onClick={() => void load(nextOffset)}
        >
          Show more memories
        </button>
      ) : null}
    </section>
  );
}
