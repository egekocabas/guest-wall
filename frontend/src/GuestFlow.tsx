import { useCallback, useEffect, useRef, useState } from "react";

import { ApiError, api, type Preview, type PrinterStatus, type Visibility } from "./api";

interface GuestFlowProps {
  onAdded: () => void;
}

type CaptionMode = "none" | "date" | "datetime";
type Phase = "choose" | "preview" | "printing" | "adding" | "done";
type Completion = "printed" | "added";

interface PreviewSelection {
  captionMode: CaptionMode;
  mirrored: boolean;
}

export function GuestFlow({ onAdded }: GuestFlowProps) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [selectedAt, setSelectedAt] = useState<Date | null>(null);
  const [captionMode, setCaptionMode] = useState<CaptionMode>("none");
  const [mirrored, setMirrored] = useState(false);
  const [visibility, setVisibility] = useState<Visibility>("public");
  const [phase, setPhase] = useState<Phase>("choose");
  const [completion, setCompletion] = useState<Completion>("printed");
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState("");
  const [printerStatus, setPrinterStatus] = useState<PrinterStatus | null>(null);
  const [checkingPrinter, setCheckingPrinter] = useState(false);
  const previewCache = useRef(new Map<string, Preview>());
  const previewRequests = useRef(new Map<string, Promise<Preview>>());
  const mirroredFile = useRef<Promise<File> | null>(null);
  const selectedFileRef = useRef<File | null>(null);
  const desiredSelection = useRef<PreviewSelection>({ captionMode: "none", mirrored: false });
  const shownSelection = useRef<PreviewSelection | null>(null);
  const flowGeneration = useRef(0);

  const refreshPrinterStatus = useCallback(async () => {
    setCheckingPrinter(true);
    try {
      setPrinterStatus(await api.printerStatus());
    } catch {
      setPrinterStatus({ online: false, hardware_status: null });
    } finally {
      setCheckingPrinter(false);
    }
  }, []);

  useEffect(() => {
    void api
      .printerStatus()
      .then(setPrinterStatus)
      .catch(() => setPrinterStatus({ online: false, hardware_status: null }));
  }, []);

  useEffect(
    () => () => {
      flowGeneration.current += 1;
      void discardPreviews(previewCache.current);
    },
    [],
  );

  async function choose(file?: File) {
    if (!file) return;
    void refreshPrinterStatus();
    const generation = flowGeneration.current + 1;
    flowGeneration.current = generation;
    void discardPreviews(previewCache.current);
    previewCache.current = new Map();
    previewRequests.current = new Map();
    mirroredFile.current = null;
    selectedFileRef.current = file;
    desiredSelection.current = { captionMode: "none", mirrored: false };
    shownSelection.current = null;
    setError("");
    const capturedAt = new Date();
    setSelectedAt(capturedAt);
    setCaptionMode("none");
    setMirrored(false);
    setPreview(null);
    setPhase("preview");
    setPreparing(true);
    await selectPreview({ captionMode: "none", mirrored: false }, file, capturedAt, generation);
  }

  async function selectPreview(
    selection: PreviewSelection,
    file = selectedFileRef.current,
    capturedAt = selectedAt,
    generation = flowGeneration.current,
  ) {
    if (!file || !capturedAt) return;
    desiredSelection.current = selection;
    setCaptionMode(selection.captionMode);
    setMirrored(selection.mirrored);
    setError("");
    const key = previewKey(selection);
    const cached = previewCache.current.get(key);
    if (cached) {
      shownSelection.current = selection;
      setPreview(cached);
      setPreparing(false);
      return;
    }

    setPreparing(true);
    let request = previewRequests.current.get(key);
    try {
      if (!request) {
        request = preparePreviewVariant(selection, file, capturedAt, getMirroredFile);
        previewRequests.current.set(key, request);
      }
      const created = await request;
      if (previewRequests.current.get(key) === request) previewRequests.current.delete(key);
      if (generation !== flowGeneration.current) {
        void api.deletePreview(created.preview_id).catch(() => undefined);
        return;
      }
      previewCache.current.set(key, created);
      if (previewKey(desiredSelection.current) !== key) return;
      shownSelection.current = selection;
      setPreview(created);
      setPreparing(false);
    } catch (caught) {
      if (previewRequests.current.get(key) === request) previewRequests.current.delete(key);
      if (generation !== flowGeneration.current || previewKey(desiredSelection.current) !== key)
        return;
      if (selection.mirrored) mirroredFile.current = null;
      const message =
        caught instanceof ApiError
          ? caught.message
          : caught instanceof Error
            ? caught.message
            : "We couldn’t prepare this photo. Try another image.";
      setError(message);
      setPreparing(false);
      if (shownSelection.current) {
        desiredSelection.current = shownSelection.current;
        setCaptionMode(shownSelection.current.captionMode);
        setMirrored(shownSelection.current.mirrored);
      } else {
        await reset();
        setError(message);
      }
    }
  }

  function getMirroredFile(file: File): Promise<File> {
    if (!mirroredFile.current) mirroredFile.current = mirrorPhoto(file);
    return mirroredFile.current;
  }

  async function submit(printPhoto: boolean) {
    if (!preview) return;
    setPhase(printPhoto ? "printing" : "adding");
    setError("");
    try {
      await api.confirmPreview(preview.preview_id, visibility, printPhoto);
      const retained = preview.preview_id;
      const variants = previewCache.current;
      previewCache.current = new Map();
      flowGeneration.current += 1;
      selectedFileRef.current = null;
      mirroredFile.current = null;
      void discardPreviews(variants, retained);
      setCompletion(printPhoto ? "printed" : "added");
      setPhase("done");
      onAdded();
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : printPhoto
            ? "The printer is unavailable. Your photo has not been added yet."
            : "Your photo could not be added to the wall.",
      );
      setPhase("preview");
      if (printPhoto) void refreshPrinterStatus();
    }
  }

  async function reset() {
    flowGeneration.current += 1;
    const variants = previewCache.current;
    previewCache.current = new Map();
    previewRequests.current = new Map();
    selectedFileRef.current = null;
    mirroredFile.current = null;
    desiredSelection.current = { captionMode: "none", mirrored: false };
    shownSelection.current = null;
    setPreview(null);
    setSelectedAt(null);
    setCaptionMode("none");
    setMirrored(false);
    setPreparing(false);
    setError("");
    setPhase("choose");
    await discardPreviews(variants);
  }

  return (
    <section
      className="mx-auto w-full max-w-xl px-4 pb-12 pt-2 sm:px-6 sm:pb-16 sm:pt-8"
      aria-labelledby="contribute-title"
    >
      <div className="paper-card overflow-hidden p-5 min-[380px]:p-6 sm:p-8">
        {phase === "choose" ? (
          <div className="text-center">
            <p className="mb-3 font-mono text-[0.65rem] uppercase tracking-[0.26em] text-ink/50">
              Print a moment
            </p>
            <h1
              id="contribute-title"
              className="font-display text-[2.35rem] font-black leading-[0.95] tracking-tight min-[380px]:text-4xl sm:text-5xl"
            >
              Leave a little
              <br />
              piece of today.
            </h1>
            <PrinterNotice
              status={printerStatus}
              checking={checkingPrinter}
              onCheck={() => void refreshPrinterStatus()}
            />
            <div className="mt-7 grid gap-3 sm:grid-cols-2">
              <label className="primary-button cursor-pointer">
                <CameraIcon /> Take a photo
                <input
                  aria-label="Take a photo"
                  className="sr-only"
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={(event) => void choose(event.target.files?.[0])}
                />
              </label>
              <label className="secondary-button cursor-pointer">
                <ImageIcon /> Choose from library
                <input
                  aria-label="Choose from library"
                  className="sr-only"
                  type="file"
                  accept="image/*"
                  onChange={(event) => void choose(event.target.files?.[0])}
                />
              </label>
            </div>
          </div>
        ) : null}

        {(phase === "preview" || phase === "printing" || phase === "adding") && preview ? (
          <div>
            <div className="relative mx-auto mb-5 max-w-sm overflow-hidden bg-white p-3 pb-5 shadow-paper">
              <img
                src={preview.preview_url}
                alt="Your thermal print preview"
                className="w-full grayscale"
              />
              {preparing ? <PreviewSpinner /> : null}
            </div>
            <div className="flex justify-center">
              <button
                type="button"
                className="secondary-button"
                aria-pressed={mirrored}
                disabled={preparing || phase !== "preview"}
                onClick={() => void selectPreview({ captionMode, mirrored: !mirrored })}
              >
                <MirrorIcon /> Mirror photo
              </button>
            </div>
            {selectedAt ? (
              <fieldset className="mt-6" disabled={preparing || phase !== "preview"}>
                <legend className="font-display text-xl font-bold">Add a timestamp?</legend>
                <CaptionChoice
                  mode="none"
                  selected={captionMode}
                  label="No date"
                  onSelect={(mode) => void selectPreview({ captionMode: mode, mirrored })}
                />
                <CaptionChoice
                  mode="date"
                  selected={captionMode}
                  label="Date"
                  detail={formatCaption(selectedAt, "date").date ?? ""}
                  onSelect={(mode) => void selectPreview({ captionMode: mode, mirrored })}
                />
                <CaptionChoice
                  mode="datetime"
                  selected={captionMode}
                  label="Date & time"
                  detail={`${formatCaption(selectedAt, "datetime").date} ${formatCaption(selectedAt, "datetime").time}`}
                  onSelect={(mode) => void selectPreview({ captionMode: mode, mirrored })}
                />
              </fieldset>
            ) : null}
            <fieldset className="mt-6" disabled={phase !== "preview"}>
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
                  <small>Only visible to people in the home network</small>
                </span>
              </label>
            </fieldset>
            <PrinterNotice
              status={printerStatus}
              checking={checkingPrinter}
              onCheck={() => void refreshPrinterStatus()}
            />
            <button
              className="primary-button mt-5 w-full"
              disabled={phase !== "preview" || preparing || !printerCanPrint(printerStatus)}
              onClick={() => void submit(true)}
            >
              {phase === "printing" ? "Printing…" : "Print & Add to The Wall"}
            </button>
            <button
              className="secondary-button mt-3 w-full"
              disabled={phase !== "preview" || preparing}
              onClick={() => void submit(false)}
            >
              {phase === "adding" ? "Adding…" : "Add to Wall Only"}
            </button>
            <button
              className="quiet-action mt-2"
              disabled={phase !== "preview"}
              onClick={() => void reset()}
            >
              Choose a different photo
            </button>
          </div>
        ) : null}

        {phase === "preview" && !preview ? (
          <div className="py-12 text-center" role="status">
            <LoadingIcon />
            <h2 className="mt-5 font-display text-3xl font-black">Preparing your preview…</h2>
            <p className="mt-2 text-sm text-ink/60">
              The printer is creating the basic thermal version first.
            </p>
            <button className="quiet-action mt-5" onClick={() => void reset()}>
              Cancel
            </button>
          </div>
        ) : null}

        {phase === "done" ? (
          <div className="py-8 text-center" role="status">
            <div className="mx-auto mb-5 grid size-16 place-items-center rounded-full bg-ink text-3xl text-paper">
              ✓
            </div>
            <h2 className="font-display text-4xl font-black">
              {completion === "printed" ? "Printed!" : "Added!"}
            </h2>
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

function printerCanPrint(status: PrinterStatus | null): boolean {
  if (!status) return true;
  return status.online && (status.hardware_status === null || status.hardware_status === "ready");
}

function PrinterNotice({
  status,
  checking,
  onCheck,
}: {
  status: PrinterStatus | null;
  checking: boolean;
  onCheck: () => void;
}) {
  let message: string | null = null;
  if (status && !status.online) {
    message = "The printer seems offline. You can still add your photo to the wall.";
  } else if (status?.hardware_status === "paper_out") {
    message = "The printer is out of paper. Add a roll, then check again.";
  } else if (status?.hardware_status === "error") {
    message = "The printer needs attention. You can still add your photo to the wall.";
  } else if (status?.hardware_status === "unknown") {
    message = "The printer is online but not ready. Check it before printing.";
  }
  if (!message) return null;

  return (
    <div role="status" className="mt-5 rounded-lg bg-amber-100 px-3 py-2 text-sm text-amber-900">
      <p>{message}</p>
      <button
        type="button"
        className="mt-2 font-semibold underline underline-offset-2 disabled:opacity-60"
        disabled={checking}
        onClick={onCheck}
      >
        {checking ? "Checking…" : "Check again"}
      </button>
    </div>
  );
}

function previewKey(selection: PreviewSelection): string {
  return `${selection.mirrored ? "mirrored" : "original"}:${selection.captionMode}`;
}

async function preparePreviewVariant(
  selection: PreviewSelection,
  file: File,
  capturedAt: Date,
  getMirroredFile: (file: File) => Promise<File>,
): Promise<Preview> {
  const source = selection.mirrored ? await getMirroredFile(file) : file;
  const caption = formatCaption(capturedAt, selection.captionMode);
  return api.createPreview(source, caption.date, caption.time);
}

async function discardPreviews(previews: Map<string, Preview>, exceptId?: string): Promise<void> {
  const ids = new Set([...previews.values()].map((item) => item.preview_id));
  if (exceptId) ids.delete(exceptId);
  await Promise.all([...ids].map((id) => api.deletePreview(id).catch(() => undefined)));
}

async function mirrorPhoto(file: File): Promise<File> {
  const sourceUrl = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = sourceUrl;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Image mirroring is not supported by this browser.");
    context.translate(canvas.width, 0);
    context.scale(-1, 1);
    context.drawImage(image, 0, 0);
    const type = file.type === "image/png" ? "image/png" : "image/jpeg";
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (output) =>
          output ? resolve(output) : reject(new Error("The mirrored photo could not be created.")),
        type,
        0.95,
      ),
    );
    return new File([blob], `mirrored-${file.name.replace(/\.[^.]+$/, "")}`, {
      type,
      lastModified: file.lastModified,
    });
  } finally {
    URL.revokeObjectURL(sourceUrl);
  }
}

function PreviewSpinner() {
  return (
    <div
      className="absolute inset-0 grid place-items-center bg-white/75 backdrop-blur-[1px]"
      role="status"
      aria-label="Preparing selected preview"
    >
      <LoadingIcon />
    </div>
  );
}

function LoadingIcon() {
  return (
    <span
      aria-hidden="true"
      className="mx-auto block size-9 animate-spin rounded-full border-4 border-ink/15 border-t-ink"
    />
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
  detail?: string;
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
        {detail ? <small>{detail}</small> : null}
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

function MirrorIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="size-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <path d="M12 3v18M8 7 4 12l4 5M16 7l4 5-4 5" />
    </svg>
  );
}
