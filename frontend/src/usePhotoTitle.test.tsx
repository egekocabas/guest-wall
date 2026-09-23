import { act, cleanup, renderHook } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { usePhotoTitle } from "./usePhotoTitle";

let reducedMotion: EventTarget & { matches: boolean };

beforeEach(() => {
  vi.useFakeTimers();
  document.title = "Guestwall";
  vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  reducedMotion = Object.assign(new EventTarget(), { matches: false });
  vi.stubGlobal("matchMedia", vi.fn().mockReturnValue(reducedMotion));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("photo title", () => {
  it("repeats the photo scene after exactly 5 seconds, including in React Strict Mode", () => {
    const { rerender } = renderHook(() => usePhotoTitle(true), { wrapper: StrictMode });
    expect(document.title).toBe("Guestwall");
    act(() => vi.advanceTimersByTime(1800));
    expect(document.title).toBe("(o_o)___📷___(o_o)");
    rerender();
    act(() => vi.advanceTimersByTime(3300));
    expect(document.title).toBe("___(^_^)📸(^_^)___");
    act(() => vi.advanceTimersByTime(3450));
    expect(document.title).toBe("Guestwall");
    act(() => vi.advanceTimersByTime(4_999));
    expect(document.title).toBe("Guestwall");
    act(() => vi.advanceTimersByTime(1));
    expect(document.title).toBe("(o_o)___📷___(o_o)");
    act(() => vi.advanceTimersByTime(6750));
    expect(document.title).toBe("Guestwall");
    act(() => vi.advanceTimersByTime(5_000));
    expect(document.title).toBe("(o_o)___📷___(o_o)");
    expect(vi.getTimerCount()).toBe(1);
  });

  it("restarts from the beginning after switching tabs and clears timers on unmount", () => {
    const { unmount } = renderHook(() => usePhotoTitle(true));
    act(() => vi.advanceTimersByTime(5100));
    expect(document.title).toBe("___(^_^)📸(^_^)___");
    vi.spyOn(document, "hidden", "get").mockReturnValue(true);
    document.dispatchEvent(new Event("visibilitychange"));
    expect(document.title).toBe("Guestwall");
    expect(vi.getTimerCount()).toBe(0);
    vi.spyOn(document, "hidden", "get").mockReturnValue(false);
    document.dispatchEvent(new Event("visibilitychange"));
    expect(document.title).toBe("Guestwall");
    act(() => vi.advanceTimersByTime(1799));
    expect(document.title).toBe("Guestwall");
    act(() => vi.advanceTimersByTime(1));
    expect(document.title).toBe("(o_o)___📷___(o_o)");
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(document.title).toBe("Guestwall");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(vi.getTimerCount()).toBe(0);
  });

  it("stays static when disabled or reduced motion is preferred", () => {
    const { rerender } = renderHook(({ enabled }) => usePhotoTitle(enabled), {
      initialProps: { enabled: false },
    });
    expect(vi.getTimerCount()).toBe(0);
    reducedMotion.matches = true;
    rerender({ enabled: true });
    expect(vi.getTimerCount()).toBe(0);
    expect(document.title).toBe("Guestwall");
  });

  it("does not restart in a hidden tab or after unmounting during the repeat delay", () => {
    const { unmount } = renderHook(() => usePhotoTitle(true));
    act(() => vi.advanceTimersByTime(8550));
    vi.spyOn(document, "hidden", "get").mockReturnValue(true);
    document.dispatchEvent(new Event("visibilitychange"));
    act(() => vi.advanceTimersByTime(60_000));
    expect(document.title).toBe("Guestwall");
    expect(vi.getTimerCount()).toBe(0);
    vi.spyOn(document, "hidden", "get").mockReturnValue(false);
    document.dispatchEvent(new Event("visibilitychange"));
    expect(document.title).toBe("Guestwall");
    expect(vi.getTimerCount()).toBe(1);
    act(() => vi.advanceTimersByTime(1800));
    expect(document.title).toBe("(o_o)___📷___(o_o)");
    unmount();
    act(() => vi.advanceTimersByTime(5_000));
    expect(document.title).toBe("Guestwall");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("stops immediately if reduced motion is enabled during the scene", () => {
    renderHook(() => usePhotoTitle(true));
    act(() => vi.advanceTimersByTime(1800));
    reducedMotion.matches = true;
    reducedMotion.dispatchEvent(new Event("change"));
    expect(document.title).toBe("Guestwall");
    expect(vi.getTimerCount()).toBe(0);
    document.dispatchEvent(new Event("visibilitychange"));
    expect(vi.getTimerCount()).toBe(0);
  });
});
