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
  it("plays the photo scene once, including in React Strict Mode", () => {
    const { rerender } = renderHook(() => usePhotoTitle(true), { wrapper: StrictMode });
    expect(document.title).toBe("Guestwall");
    act(() => vi.advanceTimersByTime(1800));
    expect(document.title).toBe("(o_o)___[o]___(o_o)");
    rerender();
    act(() => vi.advanceTimersByTime(3300));
    expect(document.title).toBe("___(^_^)[*](^_^)___");
    act(() => vi.runAllTimers());
    expect(document.title).toBe("Guestwall");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(vi.getTimerCount()).toBe(0);
  });

  it("pauses while hidden and restores the title and timers on unmount", () => {
    const { unmount } = renderHook(() => usePhotoTitle(true));
    act(() => vi.advanceTimersByTime(1800));
    vi.spyOn(document, "hidden", "get").mockReturnValue(true);
    document.dispatchEvent(new Event("visibilitychange"));
    expect(document.title).toBe("Guestwall");
    expect(vi.getTimerCount()).toBe(0);
    vi.spyOn(document, "hidden", "get").mockReturnValue(false);
    document.dispatchEvent(new Event("visibilitychange"));
    expect(document.title).toBe("(o_o)___[o]___(o_o)");
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
