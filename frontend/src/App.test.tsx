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
    expect(fetchMock).toHaveBeenCalledWith("/api/public/photos?offset=0&limit=24", undefined);
    expect(screen.queryByLabelText("Take a photo")).not.toBeInTheDocument();
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
    await user.click(screen.getByRole("button", { name: "Print & add to wall" }));
    expect(await screen.findByText("Printed!")).toBeInTheDocument();
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/previews/preview-1/confirm",
        expect.objectContaining({ method: "POST" }),
      ),
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

    await user.click(screen.getByRole("button", { name: "Use original direction" }));
    expect(screen.getByAltText("Your thermal print preview")).toHaveAttribute(
      "src",
      "/original.png",
    );
    expect(uploadedNames).toHaveLength(2);
  });
});
