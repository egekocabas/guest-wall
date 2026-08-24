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
        <p className="max-w-36 pr-3 text-right font-mono text-[0.6rem] uppercase leading-4 tracking-[0.16em] text-ink/50 sm:max-w-none sm:tracking-[0.2em]">
          {mode === "public" ? "From our home to yours" : "Tiny paper memories"}
        </p>
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
      <footer className="border-t border-ink/10 px-4 pb-[max(2rem,env(safe-area-inset-bottom))] pt-8 text-center font-mono text-[0.65rem] uppercase leading-4 tracking-[0.12em] text-ink/45 sm:px-6 sm:tracking-widest">
        Original photos are never kept · only their thermal versions live here
      </footer>
    </main>
  );
}
