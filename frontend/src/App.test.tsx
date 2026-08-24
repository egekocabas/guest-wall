import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";

afterEach(() => vi.restoreAllMocks());

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
    await user.click(screen.getByRole("button", { name: "Create preview" }));
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
    let previewForm: FormData | undefined;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === "/api/printer/status") return new Response(JSON.stringify({ online: true }));
      if (url.startsWith("/api/photos?"))
        return new Response(JSON.stringify({ items: [], next_offset: null }));
      if (url === "/api/previews") {
        previewForm = init?.body as FormData;
        return new Response(
          JSON.stringify({
            preview_id: "preview-2",
            preview_url: "/preview-with-date.png",
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
    await user.click(screen.getByRole("radio", { name: /Date & time/ }));
    await user.click(screen.getByRole("button", { name: "Create preview" }));

    expect(await screen.findByAltText("Your thermal print preview")).toHaveAttribute(
      "src",
      "/preview-with-date.png",
    );
    expect(previewForm?.get("date")).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
    expect(previewForm?.get("time")).toMatch(/^\d{2}:\d{2}$/);
  });
});
