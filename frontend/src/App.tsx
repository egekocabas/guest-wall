import { useState } from "react";

import { Admin } from "./Admin";
import { Gallery } from "./Gallery";
import { GuestFlow } from "./GuestFlow";

export type AppMode = "lan" | "public" | "admin";

function detectMode(): AppMode {
  if (window.location.pathname.startsWith("/admin")) return "admin";
  if (
    window.location.hostname === (import.meta.env.VITE_PUBLIC_HOST || "guest-wall.egekocabas.com")
  )
    return "public";
  return "lan";
}

export function App({ modeOverride }: { modeOverride?: AppMode }) {
  const mode = modeOverride || detectMode();
  const [refreshToken, setRefreshToken] = useState(0);
  if (mode === "admin") return <Admin />;

  return (
    <main className="min-h-screen">
      <header className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-1 py-3 sm:px-3 sm:py-4">
        <a href="/" className="tap-link font-display text-2xl font-black tracking-tight">
          Guestwall<span className="text-rust">.</span>
        </a>
        {mode === "public" ? (
          <p className="max-w-36 pr-3 text-right font-mono text-[0.6rem] uppercase leading-4 tracking-[0.16em] text-ink/50 sm:max-w-none sm:tracking-[0.2em]">
            From our home to yours
          </p>
        ) : (
          <a
            href="https://github.com/egekocabas/guest-wall"
            target="_blank"
            rel="noreferrer"
            aria-label="Open Guestwall on GitHub"
            className="tap-link mr-1 text-ink/55 hover:text-ink"
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5" fill="currentColor">
              <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.426 2.865 8.18 6.839 9.504.5.093.682-.217.682-.483 0-.237-.009-.867-.014-1.702-2.782.605-3.369-1.343-3.369-1.343-.455-1.158-1.11-1.466-1.11-1.466-.908-.621.069-.608.069-.608 1.004.071 1.532 1.032 1.532 1.032.892 1.53 2.341 1.088 2.91.832.091-.647.349-1.088.635-1.338-2.221-.253-4.555-1.112-4.555-4.948 0-1.093.39-1.987 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0 1 12 6.838a9.58 9.58 0 0 1 2.504.337c1.909-1.296 2.747-1.026 2.747-1.026.546 1.378.203 2.397.1 2.65.64.701 1.028 1.595 1.028 2.688 0 3.845-2.337 4.692-4.566 4.94.359.31.679.923.679 1.86 0 1.343-.012 2.426-.012 2.755 0 .268.18.58.688.482A10.02 10.02 0 0 0 22 12.017C22 6.484 17.523 2 12 2Z" />
            </svg>
          </a>
        )}
      </header>
      {mode === "lan" ? (
        <GuestFlow onAdded={() => setRefreshToken((value) => value + 1)} />
      ) : (
        <section className="mx-auto max-w-3xl px-4 py-8 text-center sm:px-6 sm:py-16">
          <p className="font-mono text-[0.65rem] uppercase tracking-[0.28em] text-ink/50">
            A living collection
          </p>
          <h1 className="mt-3 font-display text-[2.75rem] font-black leading-[0.95] tracking-tight min-[380px]:text-5xl sm:text-7xl">
            Moments made
            <br />
            to fade slowly.
          </h1>
          <p className="mx-auto mt-5 max-w-md text-sm leading-6 text-ink/60">
            Small monochrome memories, printed at home and shared here with permission.
          </p>
        </section>
      )}
      <Gallery publicOnly={mode === "public"} refreshToken={refreshToken} />
    </main>
  );
}
