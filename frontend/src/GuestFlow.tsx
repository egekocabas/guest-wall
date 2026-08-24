import { useEffect, useRef, useState } from "react";

import { ApiError, api, type Preview, type Visibility } from "./api";

interface GuestFlowProps {
  onAdded: () => void;
}

type CaptionMode = "none" | "date" | "datetime";

export function GuestFlow({ onAdded }: GuestFlowProps) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [selectedAt, setSelectedAt] = useState<Date | null>(null);
  const [captionMode, setCaptionMode] = useState<CaptionMode>("none");
  const [visibility, setVisibility] = useState<Visibility>("public");
  const [phase, setPhase] = useState<
    "choose" | "customize" | "preparing" | "preview" | "printing" | "done"
  >("choose");
  const [error, setError] = useState("");
  const [printerOnline, setPrinterOnline] = useState<boolean | null>(null);
  const activePreview = useRef<string | null>(null);

  useEffect(() => {
    void api
      .printerStatus()
      .then((status) => setPrinterOnline(status.online))
      .catch(() => setPrinterOnline(false));
  }, []);

  useEffect(
    () => () => {
      if (activePreview.current)
        void api.deletePreview(activePreview.current).catch(() => undefined);
    },
    [],
  );

  function choose(file?: File) {
    if (!file) return;
    setError("");
    setSelectedFile(file);
    setSelectedAt(new Date());
    setCaptionMode("none");
    setPhase("customize");
  }

  async function preparePreview() {
    if (!selectedFile || !selectedAt) return;
    setError("");
    setPhase("preparing");
    try {
      const caption = formatCaption(selectedAt, captionMode);
      const created = await api.createPreview(selectedFile, caption.date, caption.time);
      activePreview.current = created.preview_id;
      setPreview(created);
      setPhase("preview");
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : "We couldn’t prepare this photo. Try another image.",
      );
      setPhase("choose");
    }
  }

  async function print() {
    if (!preview) return;
    setPhase("printing");
    setError("");
    try {
      await api.confirmPreview(preview.preview_id, visibility);
      activePreview.current = null;
      setPhase("done");
      onAdded();
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : "The printer is unavailable. Your photo has not been added yet.",
      );
      setPhase("preview");
    }
  }

  async function reset() {
    if (activePreview.current)
      await api.deletePreview(activePreview.current).catch(() => undefined);
    activePreview.current = null;
    setPreview(null);
    setSelectedFile(null);
    setSelectedAt(null);
    setCaptionMode("none");
    setError("");
    setPhase("choose");
  }

  return (
    <section
      className="mx-auto w-full max-w-xl px-4 pb-16 pt-5 sm:px-6 sm:pt-10"
      aria-labelledby="contribute-title"
    >
      <div className="paper-card overflow-hidden p-5 sm:p-8">
        {phase === "choose" ? (
          <div className="text-center">
            <p className="mb-3 font-mono text-[0.65rem] uppercase tracking-[0.26em] text-ink/50">
              Print a moment
            </p>
            <h1
              id="contribute-title"
              className="font-display text-4xl font-black leading-none tracking-tight sm:text-5xl"
            >
              Leave a little
              <br />
              piece of today.
            </h1>
            <p className="mx-auto mt-4 max-w-sm text-sm leading-6 text-ink/60">
              Choose a photo. You’ll see exactly how its tiny paper version will look before it
              prints.
            </p>
            {printerOnline === false ? (
              <p
                role="status"
                className="mt-5 rounded-lg bg-amber-100 px-3 py-2 text-sm text-amber-900"
              >
                The printer seems offline. You can still enjoy the wall.
              </p>
            ) : null}
            <div className="mt-7 grid gap-3 sm:grid-cols-2">
              <label className="primary-button cursor-pointer">
                <CameraIcon /> Take a photo
                <input
                  aria-label="Take a photo"
                  className="sr-only"
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={(event) => choose(event.target.files?.[0])}
                />
              </label>
              <label className="secondary-button cursor-pointer">
                <ImageIcon /> Choose from library
                <input
                  aria-label="Choose from library"
                  className="sr-only"
                  type="file"
                  accept="image/*"
                  onChange={(event) => choose(event.target.files?.[0])}
                />
              </label>
            </div>
          </div>
        ) : null}

        {(phase === "customize" || phase === "preparing") && selectedAt ? (
          <div>
            <p className="font-mono text-[0.65rem] uppercase tracking-[0.26em] text-ink/50">
              Photo selected
            </p>
            <h1
              id="contribute-title"
              className="mt-2 font-display text-3xl font-black tracking-tight sm:text-4xl"
            >
              Add a timestamp?
            </h1>
            <p className="mt-2 text-sm leading-6 text-ink/60">
              This is optional. It will appear below the photo in the preview and on paper.
            </p>
            <fieldset className="mt-5" disabled={phase === "preparing"}>
              <legend className="sr-only">Timestamp on print</legend>
              <CaptionChoice
                mode="none"
                selected={captionMode}
                label="No date"
                detail="Print only the photo"
                onSelect={setCaptionMode}
              />
              <CaptionChoice
                mode="date"
                selected={captionMode}
                label="Date"
                detail={formatCaption(selectedAt, "date").date ?? ""}
                onSelect={setCaptionMode}
              />
              <CaptionChoice
                mode="datetime"
                selected={captionMode}
                label="Date & time"
                detail={`${formatCaption(selectedAt, "datetime").date} ${formatCaption(selectedAt, "datetime").time}`}
                onSelect={setCaptionMode}
              />
            </fieldset>
            <button
              className="primary-button mt-5 w-full"
              disabled={phase === "preparing"}
              onClick={() => void preparePreview()}
            >
              {phase === "preparing" ? "Preparing your print…" : "Create preview"}
            </button>
            <button
              className="mt-4 w-full text-sm text-ink/55 underline underline-offset-4"
              disabled={phase === "preparing"}
              onClick={() => void reset()}
            >
              Choose a different photo
            </button>
          </div>
        ) : null}

        {(phase === "preview" || phase === "printing") && preview ? (
          <div>
            <p className="font-mono text-[0.65rem] uppercase tracking-[0.26em] text-ink/50">
              This will be printed
            </p>
            <div className="mx-auto my-5 max-w-sm bg-white p-3 pb-5 shadow-paper">
              <img
                src={preview.preview_url}
                alt="Your thermal print preview"
                className="w-full grayscale"
              />
            </div>
            <fieldset className="mt-6">
              <legend className="font-display text-xl font-bold">Who can see it?</legend>
              <label className={`choice ${visibility === "public" ? "choice-selected" : ""}`}>
                <input
                  type="radio"
                  name="visibility"
                  value="public"
                  checked={visibility === "public"}
                  onChange={() => setVisibility("public")}
                />
                <span>
                  <strong>Everyone</strong>
                  <small>Also visible on the public Guestwall</small>
                </span>
              </label>
              <label className={`choice ${visibility === "private" ? "choice-selected" : ""}`}>
                <input
                  type="radio"
                  name="visibility"
                  value="private"
                  checked={visibility === "private"}
                  onChange={() => setVisibility("private")}
                />
                <span>
                  <strong>Home only</strong>
                  <small>Only visible to people on the home wall</small>
                </span>
              </label>
            </fieldset>
            <button
              className="primary-button mt-5 w-full"
              disabled={phase === "printing"}
              onClick={() => void print()}
            >
              {phase === "printing" ? "Printing…" : "Print & add to wall"}
            </button>
            <button
              className="mt-4 w-full text-sm text-ink/55 underline underline-offset-4"
              disabled={phase === "printing"}
              onClick={() => void reset()}
            >
              Choose a different photo
            </button>
          </div>
        ) : null}

        {phase === "done" ? (
          <div className="py-8 text-center" role="status">
            <div className="mx-auto mb-5 grid size-16 place-items-center rounded-full bg-ink text-3xl text-paper">
              ✓
            </div>
            <h2 className="font-display text-4xl font-black">Printed!</h2>
            <p className="mt-2 text-ink/60">Your moment is now part of the Guestwall.</p>
            <button className="secondary-button mt-7" onClick={() => void reset()}>
              Add another photo
            </button>
          </div>
        ) : null}

        {error ? (
          <p role="alert" className="mt-5 rounded-lg bg-red-50 p-3 text-sm text-red-800">
            {error}
          </p>
        ) : null}
      </div>
    </section>
  );
}

function CaptionChoice({
  mode,
  selected,
  label,
  detail,
  onSelect,
}: {
  mode: CaptionMode;
  selected: CaptionMode;
  label: string;
  detail: string;
  onSelect: (mode: CaptionMode) => void;
}) {
  return (
    <label className={`choice ${selected === mode ? "choice-selected" : ""}`}>
      <input
        type="radio"
        name="caption"
        value={mode}
        checked={selected === mode}
        onChange={() => onSelect(mode)}
      />
      <span>
        <strong>{label}</strong>
        <small>{detail}</small>
      </span>
    </label>
  );
}

function formatCaption(value: Date, mode: CaptionMode): { date?: string; time?: string } {
  if (mode === "none") return {};
  const pad = (part: number) => String(part).padStart(2, "0");
  const date = `${pad(value.getDate())}/${pad(value.getMonth() + 1)}/${value.getFullYear()}`;
  if (mode === "date") return { date };
  return { date, time: `${pad(value.getHours())}:${pad(value.getMinutes())}` };
}

function CameraIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="size-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <path d="M14.5 4 16 7h3a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h3l1.5-3z" />
      <circle cx="12" cy="13" r="4" />
    </svg>
  );
}

function ImageIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="size-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <path d="m21 15-5-5L5 21" />
    </svg>
  );
}
