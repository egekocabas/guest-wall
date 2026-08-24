import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Guestwall", () => {
  it("uses only the public gallery API in public mode", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify({ items: [], next_offset: null }), { status: 200 }),
      );
    render(<App modeOverride="public" />);
    expect(await screen.findByText("The wall is waiting.")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith("/api/public/photos?offset=0&limit=12", undefined);
    expect(screen.queryByLabelText("Take a photo")).not.toBeInTheDocument();
  });

  it("paginates the wall without retaining earlier pages", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      const offset = new URL(url, "http://guestwall.test").searchParams.get("offset");
      const indexes = offset === "12" ? [12] : Array.from({ length: 12 }, (_, index) => index);
      return new Response(
        JSON.stringify({
          items: indexes.map((index) => ({
            id: `page-photo-${index}`,
            created_at: `2026-08-24T16:${String(59 - index).padStart(2, "0")}:00Z`,
            visibility: "public",
            print_status: "printed",
            image_url: `/page-photo-${index}.png`,
          })),
          next_offset: offset === "12" ? null : 12,
          total: 13,
        }),
      );
    });

    const user = userEvent.setup();
    const { container } = render(<App modeOverride="public" />);
    expect(await screen.findByText("12 shown / 13 total")).toBeInTheDocument();
    expect(screen.getByText("Page 1")).toHaveAttribute("aria-current", "page");

    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByText("1 shown / 13 total")).toBeInTheDocument();
    expect(screen.getByText("Page 2")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "A thermal Guestwall memory" })).toHaveAttribute(
      "src",
      "/page-photo-12.png",
    );
    expect(container.querySelector('img[src="/page-photo-0.png"]')).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith("/api/public/photos?offset=12&limit=12", undefined);

    await user.click(screen.getByRole("button", { name: "Previous" }));
    expect(await screen.findByText("12 shown / 13 total")).toBeInTheDocument();
    expect(screen.getByText("Page 1")).toBeInTheDocument();
  });

  it("keeps gallery order and eagerly loads the first visible photos", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          items: Array.from({ length: 9 }, (_, index) => ({
            id: `photo-${index}`,
            created_at: `2026-08-24T16:0${8 - index}:00Z`,
            visibility: "public",
            print_status: "printed",
            image_url: `/photo-${index}.png`,
          })),
          next_offset: null,
        }),
        { status: 200 },
      ),
    );

    const { container } = render(<App modeOverride="public" />);
    const photos = await screen.findAllByRole("img", { name: "A thermal Guestwall memory" });

    expect(photos.map((photo) => photo.getAttribute("src"))).toEqual(
      Array.from({ length: 9 }, (_, index) => `/photo-${index}.png`),
    );
    expect(photos[0]).toHaveAttribute("loading", "eager");
    expect(photos[0]).toHaveAttribute("fetchpriority", "high");
    expect(photos[0]).toHaveAttribute("width", "384");
    expect(photos[0]).toHaveAttribute("height", "554");
    expect(photos[7]).toHaveAttribute("loading", "eager");
    expect(photos[8]).toHaveAttribute("loading", "lazy");
    expect(photos[8]).toHaveAttribute("fetchpriority", "auto");

    const gallery = container.querySelector(".paper-photo")?.parentElement;
    expect(gallery).toHaveClass("grid", "grid-cols-2");
    expect(gallery).not.toHaveClass("columns-2");
  });

  it("keeps wall dates behind an accessible hover and tap control", async () => {
    const createdAt = "2026-08-24T16:00:00Z";
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url === "/api/printer/status") return new Response(JSON.stringify({ online: true }));
      if (url.startsWith("/api/photos?"))
        return new Response(
          JSON.stringify({
            items: [
              {
                id: "home-photo",
                created_at: createdAt,
                visibility: "private",
                print_status: "printed",
                image_url: "/home-photo.png",
              },
            ],
            next_offset: null,
          }),
        );
      return new Response(null, { status: 204 });
    });

    const user = userEvent.setup();
    const { container } = render(<App modeOverride="lan" />);
    expect(await screen.findByText("home")).toBeInTheDocument();
    expect(container.querySelector("figcaption time")).not.toBeInTheDocument();

    const dateControl = screen.getByRole("button", { name: "Show added date" });
    const details = dateControl.closest("details");
    expect(details).not.toHaveAttribute("open");
    await user.click(dateControl);
    expect(details).toHaveAttribute("open");
    expect(details?.querySelector("time")).toHaveTextContent(
      `Added ${new Intl.DateTimeFormat(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      }).format(new Date(createdAt))}`,
    );
  });

  it("previews and confirms a guest photo", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === "/api/printer/status") return new Response(JSON.stringify({ online: true }));
      if (url.startsWith("/api/photos?"))
        return new Response(JSON.stringify({ items: [], next_offset: null }));
      if (url === "/api/previews")
        return new Response(
          JSON.stringify({
            preview_id: "preview-1",
            preview_url: "/preview.png",
            expires_at: "2026-01-01T00:00:00",
          }),
          { status: 201 },
        );
      if (url === "/api/previews/preview-1/confirm" && init?.method === "POST")
        return new Response(
          JSON.stringify({
            id: "preview-1",
            created_at: "2026-01-01T00:00:00",
            visibility: "public",
            print_status: "printed",
            image_url: "/photo.png",
          }),
        );
      return new Response(null, { status: 204 });
    });
    const user = userEvent.setup();
    render(<App modeOverride="lan" />);
    await user.upload(
      screen.getByLabelText("Choose from library"),
      new File(["photo"], "photo.jpg", { type: "image/jpeg" }),
    );
    expect(await screen.findByAltText("Your thermal print preview")).toHaveAttribute(
      "src",
      "/preview.png",
    );
    await user.click(screen.getByRole("button", { name: "Print & Add to The Wall" }));
    expect(await screen.findByText("Printed!")).toBeInTheDocument();
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/previews/preview-1/confirm",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ visibility: "public", print: true }),
        }),
      ),
    );
  });

  it("adds a photo to the wall without printing", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === "/api/printer/status") return new Response(JSON.stringify({ online: false }));
      if (url.startsWith("/api/photos?"))
        return new Response(JSON.stringify({ items: [], next_offset: null }));
      if (url === "/api/previews")
        return new Response(
          JSON.stringify({
            preview_id: "wall-only",
            preview_url: "/preview.png",
            expires_at: "2026-01-01T00:00:00",
          }),
          { status: 201 },
        );
      if (url === "/api/previews/wall-only/confirm" && init?.method === "POST")
        return new Response(
          JSON.stringify({
            id: "wall-only",
            created_at: "2026-01-01T00:00:00",
            visibility: "public",
            print_status: "not_printed",
            image_url: "/photo.png",
          }),
        );
      return new Response(null, { status: 204 });
    });

    const user = userEvent.setup();
    render(<App modeOverride="lan" />);
    await user.upload(
      screen.getByLabelText("Choose from library"),
      new File(["photo"], "photo.jpg", { type: "image/jpeg" }),
    );
    const addOnly = await screen.findByRole("button", { name: "Add to Wall Only" });
    expect(addOnly).toHaveClass("secondary-button");
    await user.click(addOnly);

    expect(await screen.findByText("Added!")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/previews/wall-only/confirm",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ visibility: "public", print: false }),
      }),
    );
  });

  it("adds the current date and time to the preview when selected", async () => {
    const previewForms: FormData[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === "/api/printer/status") return new Response(JSON.stringify({ online: true }));
      if (url.startsWith("/api/photos?"))
        return new Response(JSON.stringify({ items: [], next_offset: null }));
      if (url === "/api/previews") {
        const form = init?.body as FormData;
        previewForms.push(form);
        const hasTime = form.has("time");
        return new Response(
          JSON.stringify({
            preview_id: hasTime ? "preview-with-date" : "preview-basic",
            preview_url: hasTime ? "/preview-with-date.png" : "/preview-basic.png",
            expires_at: "2026-08-24T18:34:00",
          }),
          { status: 201 },
        );
      }
      return new Response(null, { status: 204 });
    });

    const user = userEvent.setup();
    render(<App modeOverride="lan" />);
    await user.upload(
      screen.getByLabelText("Choose from library"),
      new File(["photo"], "photo.jpg", { type: "image/jpeg" }),
    );
    expect(await screen.findByAltText("Your thermal print preview")).toHaveAttribute(
      "src",
      "/preview-basic.png",
    );
    await user.click(screen.getByRole("radio", { name: /Date & time/ }));

    await waitFor(() =>
      expect(screen.getByAltText("Your thermal print preview")).toHaveAttribute(
        "src",
        "/preview-with-date.png",
      ),
    );
    expect(previewForms).toHaveLength(2);
    expect(previewForms[1]?.get("date")).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
    expect(previewForms[1]?.get("time")).toMatch(/^\d{2}:\d{2}$/);

    await user.click(screen.getByRole("radio", { name: /No date/ }));
    expect(screen.getByAltText("Your thermal print preview")).toHaveAttribute(
      "src",
      "/preview-basic.png",
    );
    await user.click(screen.getByRole("radio", { name: /Date & time/ }));
    expect(screen.getByAltText("Your thermal print preview")).toHaveAttribute(
      "src",
      "/preview-with-date.png",
    );
    expect(previewForms).toHaveLength(2);
  });

  it("creates a printer preview from a mirrored copy and keeps the original variant", async () => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:photo");
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    vi.stubGlobal(
      "Image",
      class {
        src = "";
        naturalWidth = 120;
        naturalHeight = 80;

        async decode() {}
      },
    );
    const drawImage = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      translate: vi.fn(),
      scale: vi.fn(),
      drawImage,
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback) => {
      callback(new Blob(["mirrored"], { type: "image/jpeg" }));
    });

    const uploadedNames: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === "/api/printer/status") return new Response(JSON.stringify({ online: true }));
      if (url.startsWith("/api/photos?"))
        return new Response(JSON.stringify({ items: [], next_offset: null }));
      if (url === "/api/previews") {
        const uploaded = (init?.body as FormData).get("image") as File;
        uploadedNames.push(uploaded.name);
        const mirrored = uploaded.name.startsWith("mirrored-");
        return new Response(
          JSON.stringify({
            preview_id: mirrored ? "mirrored" : "original",
            preview_url: mirrored ? "/mirrored.png" : "/original.png",
            expires_at: "2026-08-24T18:34:00",
          }),
          { status: 201 },
        );
      }
      return new Response(null, { status: 204 });
    });

    const user = userEvent.setup();
    render(<App modeOverride="lan" />);
    await user.upload(
      screen.getByLabelText("Choose from library"),
      new File(["photo"], "photo.jpg", { type: "image/jpeg" }),
    );
    expect(await screen.findByAltText("Your thermal print preview")).toHaveAttribute(
      "src",
      "/original.png",
    );
    await user.click(screen.getByRole("button", { name: "Mirror photo" }));
    await waitFor(() =>
      expect(screen.getByAltText("Your thermal print preview")).toHaveAttribute(
        "src",
        "/mirrored.png",
      ),
    );
    expect(uploadedNames).toEqual(["photo.jpg", "mirrored-photo"]);
    expect(drawImage).toHaveBeenCalledOnce();
    expect(revoke).toHaveBeenCalledWith("blob:photo");

    await user.click(screen.getByRole("button", { name: "Mirror photo" }));
    expect(screen.getByAltText("Your thermal print preview")).toHaveAttribute(
      "src",
      "/original.png",
    );
    expect(uploadedNames).toHaveLength(2);
  });

  it("disables mirror and timestamp controls while a variant is preparing", async () => {
    let resolveDatePreview: ((response: Response) => void) | undefined;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === "/api/printer/status") return new Response(JSON.stringify({ online: true }));
      if (url.startsWith("/api/photos?"))
        return new Response(JSON.stringify({ items: [], next_offset: null }));
      if (url === "/api/previews") {
        const form = init?.body as FormData;
        if (form.has("date"))
          return new Promise<Response>((resolve) => {
            resolveDatePreview = resolve;
          });
        return new Response(
          JSON.stringify({
            preview_id: "basic",
            preview_url: "/basic.png",
            expires_at: "2026-08-24T18:34:00",
          }),
          { status: 201 },
        );
      }
      return new Response(null, { status: 204 });
    });

    const user = userEvent.setup();
    render(<App modeOverride="lan" />);
    await user.upload(
      screen.getByLabelText("Choose from library"),
      new File(["photo"], "photo.jpg", { type: "image/jpeg" }),
    );
    const mirror = await screen.findByRole("button", { name: "Mirror photo" });
    const date = screen.getByRole("radio", { name: /^Date\d/ });
    await user.click(date);

    expect(mirror).toBeDisabled();
    expect(screen.getByRole("radio", { name: "No date" })).toBeDisabled();
    expect(date).toBeDisabled();

    resolveDatePreview?.(
      new Response(
        JSON.stringify({
          preview_id: "with-date",
          preview_url: "/with-date.png",
          expires_at: "2026-08-24T18:34:00",
        }),
        { status: 201 },
      ),
    );
    await waitFor(() => expect(mirror).toBeEnabled());
    expect(date).toBeEnabled();
  });
});
