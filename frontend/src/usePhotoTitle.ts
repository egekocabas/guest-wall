import { useEffect } from "react";

const frames: readonly (readonly [string, number])[] = [
  ["Guestwall", 1800],
  ["(o_o)___📷___(o_o)", 550],
  ["_(o_o)__📷__(o_o)_", 550],
  ["__(o_o)_📷_(o_o)__", 550],
  ["___(o_o)📷(o_o)___", 550],
  ["___(^_^)📷(^_^)___", 1100],
  ["___(^_^)📸(^_^)___", 250],
  ["___(^_^)📷(^_^)___", 900],
  ["__(o_o)_📷_(o_o)__", 550],
  ["_(o_o)__📷__(o_o)_", 550],
  ["(o_o)___📷___(o_o)", 550],
  ["________📷________", 650],
  ["Guestwall", 5_000],
];

export function usePhotoTitle(enabled: boolean) {
  useEffect(() => {
    if (!enabled || !window.matchMedia) return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (reducedMotion.matches) return;

    const originalTitle = document.title;
    let frameIndex = 0;
    let timer: number | undefined;

    function pause() {
      window.clearTimeout(timer);
      document.title = originalTitle;
    }

    function playFrame() {
      if (document.hidden || frameIndex >= frames.length) return;
      const [title, duration] = frames[frameIndex];
      document.title = title;
      timer = window.setTimeout(() => {
        frameIndex += 1;
        if (frameIndex === frames.length) frameIndex = 1;
        playFrame();
      }, duration);
    }

    function onVisibilityChange() {
      pause();
      if (frameIndex >= frames.length) return;
      frameIndex = 0;
      if (!document.hidden) playFrame();
    }

    function onMotionChange() {
      if (reducedMotion.matches) {
        frameIndex = frames.length;
        pause();
      }
    }

    document.addEventListener("visibilitychange", onVisibilityChange);
    reducedMotion.addEventListener("change", onMotionChange);
    playFrame();

    return () => {
      pause();
      document.removeEventListener("visibilitychange", onVisibilityChange);
      reducedMotion.removeEventListener("change", onMotionChange);
    };
  }, [enabled]);
}
