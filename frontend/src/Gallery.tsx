import { useCallback, useEffect, useRef, useState } from "react";

import { api, type Photo } from "./api";

interface GalleryProps {
  publicOnly?: boolean;
  refreshToken?: number;
}

const EAGER_PHOTO_COUNT = 8;
const PHOTO_PAGE_SIZE = 12;

export function Gallery({ publicOnly = false, refreshToken = 0 }: GalleryProps) {
  const sectionRef = useRef<HTMLElement>(null);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(
    async (requestedOffset: number) => {
      setLoading(true);
      setError("");
      try {
        const page = await api.listPhotos(publicOnly, requestedOffset, PHOTO_PAGE_SIZE);
        setPhotos(page.items);
        setTotal(page.total ?? page.items.length);
        setOffset(requestedOffset);
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
    const timer = window.setTimeout(() => void load(0), 0);
    return () => window.clearTimeout(timer);
  }, [load, refreshToken]);

  function showPage(requestedOffset: number) {
    sectionRef.current?.scrollIntoView?.({ block: "start" });
    void load(requestedOffset);
  }

  return (
    <section
      ref={sectionRef}
      aria-labelledby="wall-title"
      className="mx-auto w-full max-w-6xl scroll-mt-4 px-4 pb-16 sm:px-6"
    >
      <div className="mb-5 flex items-end justify-between gap-4 border-b border-ink/15 pb-3 sm:mb-6">
        <div>
          <p className="font-mono text-[0.65rem] uppercase tracking-[0.24em] text-ink/50">
            Collected moments
          </p>
          <h2 id="wall-title" className="font-display text-3xl font-bold tracking-tight">
            The wall
          </h2>
        </div>
        <span className="shrink-0 pb-1 font-mono text-[0.7rem] text-ink/50 sm:text-xs">
          {photos.length} shown / {total} total
        </span>
      </div>

      {!loading && photos.length === 0 && !error ? (
        <div className="paper-card py-16 text-center">
          <p className="font-display text-2xl">The wall is waiting.</p>
          <p className="mt-2 text-sm text-ink/55">The first little memory can be yours.</p>
        </div>
      ) : null}
      {error ? <p className="rounded-xl bg-red-50 p-4 text-sm text-red-800">{error}</p> : null}

      <div className="grid grid-cols-2 items-start gap-2.5 min-[380px]:gap-3 sm:grid-cols-3 sm:gap-5 lg:grid-cols-4">
        {photos.map((photo, index) => (
          <figure
            key={photo.id}
            className="paper-photo"
            style={{ rotate: `${((index % 5) - 2) * 0.35}deg` }}
          >
            <div className="relative">
              <img
                src={photo.image_url}
                alt="A thermal Guestwall memory"
                width="384"
                height="554"
                loading={index < EAGER_PHOTO_COUNT ? "eager" : "lazy"}
                fetchPriority={index < EAGER_PHOTO_COUNT ? "high" : "auto"}
                decoding="async"
                className="h-auto w-full grayscale"
              />
              <PhotoDate createdAt={photo.created_at} />
            </div>
            {!publicOnly && photo.visibility === "private" ? (
              <figcaption className="mt-2 font-mono text-[0.65rem] uppercase leading-4 tracking-[0.08em] text-ink/50 sm:text-[0.7rem] sm:tracking-wider">
                home
              </figcaption>
            ) : null}
          </figure>
        ))}
      </div>

      {loading ? (
        <p className="py-8 text-center font-mono text-xs uppercase tracking-widest text-ink/50">
          Loading wall…
        </p>
      ) : null}
      {(offset > 0 || nextOffset !== null) && !loading ? (
        <nav
          aria-label="Wall pages"
          className="mt-8 flex items-center justify-center gap-2 sm:gap-3"
        >
          <button
            className="secondary-button px-3 disabled:cursor-not-allowed disabled:opacity-40 sm:px-5"
            disabled={offset === 0}
            onClick={() => showPage(Math.max(0, offset - PHOTO_PAGE_SIZE))}
          >
            Previous
          </button>
          <span
            aria-current="page"
            className="min-w-18 text-center font-mono text-xs uppercase tracking-wider text-ink/55"
          >
            Page {Math.floor(offset / PHOTO_PAGE_SIZE) + 1}
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
    </section>
  );
}

function PhotoDate({ createdAt }: { createdAt: string }) {
  const formattedDate = new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(createdAt));

  return (
    <details className="photo-date absolute right-1 top-1 z-10">
      <summary aria-label="Show added date" role="button" title="Show added date">
        <span aria-hidden="true">i</span>
      </summary>
      <time dateTime={createdAt}>Added {formattedDate}</time>
    </details>
  );
}
