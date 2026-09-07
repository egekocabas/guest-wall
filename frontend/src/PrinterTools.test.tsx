import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { api, ApiError } from "./api";
import { PrinterTools } from "./PrinterTools";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function mockReady(hardware_status: "ready" | "paper_out" = "ready") {
  vi.spyOn(api, "adminPrinterStatus").mockResolvedValue({ online: true, hardware_status });
  vi.spyOn(api, "printerLinks").mockResolvedValue({
    home_url: "https://home.test/",
    public_url: "https://public.test/",
  });
}

it("prints configured QR destinations and optional labels", async () => {
  mockReady();
  const print = vi.spyOn(api, "printWallQr").mockResolvedValue();
  const user = userEvent.setup();
  render(<PrinterTools />);
  expect(await screen.findByText("https://home.test/")).toBeInTheDocument();
  await user.clear(screen.getByLabelText("Home QR label (optional)"));
  await user.click(screen.getByRole("button", { name: "Print home QR" }));
  expect(print).toHaveBeenCalledWith("home", "");
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Print public QR" })).toBeEnabled(),
  );
  await user.click(screen.getByRole("button", { name: "Print public QR" }));
  expect(print).toHaveBeenCalledWith("public", "View our Guestwall");
});

it("validates custom feed counts and prevents duplicate jobs while pending", async () => {
  mockReady();
  let finish!: () => void;
  const feed = vi.spyOn(api, "feedPaper").mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const user = userEvent.setup();
  render(<PrinterTools />);
  await screen.findByText("Printer: Ready");
  const input = screen.getByLabelText("Custom lines");
  await user.clear(input);
  await user.type(input, "256");
  expect(screen.getByRole("button", { name: "Feed paper" })).toBeDisabled();
  await user.clear(input);
  await user.type(input, "7");
  await user.dblClick(screen.getByRole("button", { name: "Feed paper" }));
  expect(feed).toHaveBeenCalledExactlyOnceWith(7);
  expect(screen.getByRole("button", { name: "Print home QR" })).toBeDisabled();
  finish();
  expect(await screen.findByText("Fed 7 blank lines.")).toBeInTheDocument();
});

it("blocks printing with paper out and refreshes readiness", async () => {
  mockReady("paper_out");
  const user = userEvent.setup();
  render(<PrinterTools />);
  await screen.findByText("Printer: Out of paper");
  expect(screen.getByRole("button", { name: "3 lines" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Print public QR" })).toBeDisabled();
  vi.mocked(api.adminPrinterStatus).mockResolvedValue({ online: true, hardware_status: "ready" });
  await user.click(screen.getByRole("button", { name: "Refresh printer" }));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Print public QR" })).toBeEnabled(),
  );
});

it("shows uncertain outcomes without automatically retrying", async () => {
  mockReady();
  const feed = vi
    .spyOn(api, "feedPaper")
    .mockRejectedValue(
      new ApiError("Check the paper before sending another job.", "print_outcome_unknown", false),
    );
  const user = userEvent.setup();
  render(<PrinterTools />);
  await screen.findByText("Printer: Ready");
  await user.click(screen.getByRole("button", { name: "3 lines" }));
  expect(
    await screen.findByText("Check the paper before sending another job."),
  ).toBeInTheDocument();
  expect(feed).toHaveBeenCalledTimes(1);
});

it("disables unconfigured QR destinations", async () => {
  mockReady();
  vi.mocked(api.printerLinks).mockResolvedValue({
    home_url: null,
    public_url: "https://public.test/",
  });
  render(<PrinterTools />);
  await screen.findByText("Printer: Ready");
  expect(screen.getByRole("button", { name: "Print home QR" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Print public QR" })).toBeEnabled();
});
