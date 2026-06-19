import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { type CanvasDims, fitAspectClamped } from "./web-graph-layout";

// Space reserved below the canvas — the page's own padding (myweb/page.tsx's
// `main` carries `pb-8`/`px-8`, both 2rem), so the gap under the canvas matches
// the gap beside it and view mode never spills into a vertical scrollbar. If that
// page padding changes, change this with it. Edit mode's feed legitimately
// scrolls — the no-scrollbar guarantee is a view-mode one.
const PAGE_PAD_REM = 2;

// The root font-size in px. The app sets it larger than 16 (112.5%), so the
// reserve must resolve against the live value to land on the same px the page
// padding uses. Read once and cached by the caller — getComputedStyle forces a
// style flush, and this value doesn't change at runtime (it's a fixed app-level
// setting, unaffected by web-font loading). Falls back to 16 off the document.
function rootFontPx(): number {
  if (typeof document === "undefined") return 16;
  return parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
}

type CanvasBox = {
  // Callback ref for the full-width wrapper whose width and viewport offset are
  // measured to size the box inside (the box's own width is derived, so measuring
  // it would be circular).
  wrapRef: (el: HTMLDivElement | null) => void;
  // The aspect-clamped view/edit dimensions, or null before the first measure.
  dims: CanvasDims | null;
  // Whether the height CSS transition is armed — true for mode toggles, false for
  // the initial measure and resizes (which commit instantly). The caller applies
  // the transition; this just gates it.
  animateHeight: boolean;
};

// Measures the available rectangle (wrapper width × the space from its top down
// to the viewport floor, less the bottom reserve) and derives the aspect-clamped
// canvas dimensions. Re-measures on resize and once web fonts settle (they grow
// the header a few px, shifting the wrapper's top). Owns the transition-arming so
// only mode toggles ease, not resizes. See fitAspectClamped.
export function useCanvasBox(): CanvasBox {
  const [avail, setAvail] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const lastAvailRef = useRef<{ w: number; h: number }>({ w: 0, h: 0 });
  const [animateHeight, setAnimateHeight] = useState(false);
  const wrapElRef = useRef<HTMLDivElement | null>(null);
  const resizeObsRef = useRef<ResizeObserver | null>(null);
  const bottomReserveRef = useRef<number | null>(null);

  const measure = useCallback(() => {
    const el = wrapElRef.current;
    if (!el) return;
    if (bottomReserveRef.current === null) bottomReserveRef.current = PAGE_PAD_REM * rootFontPx();
    const w = el.clientWidth;
    const h = Math.max(0, window.innerHeight - el.getBoundingClientRect().top - bottomReserveRef.current);
    const prev = lastAvailRef.current;
    if (Math.abs(w - prev.w) < 0.5 && Math.abs(h - prev.h) < 0.5) return;
    lastAvailRef.current = { w, h };
    setAnimateHeight(false); // a resize commits instantly; only mode toggles ease
    setAvail({ w, h });
  }, []);

  // Callback ref: attach a width observer once the wrapper mounts (it only
  // renders after the loading/empty early-returns in WebGraph). A ResizeObserver
  // on the full-width element catches layout-width changes; the window 'resize'
  // listener below catches viewport-height changes the observer wouldn't see.
  const wrapRef = useCallback(
    (el: HTMLDivElement | null) => {
      resizeObsRef.current?.disconnect();
      wrapElRef.current = el;
      if (!el) {
        resizeObsRef.current = null;
        return;
      }
      measure();
      const ro = new ResizeObserver(() => measure());
      ro.observe(el);
      resizeObsRef.current = ro;
    },
    [measure],
  );

  useEffect(() => {
    window.addEventListener("resize", measure);
    // Web fonts load after first paint and grow the header a few px, shifting the
    // wrapper's top — a one-time drift neither observer above would catch, and
    // which would otherwise leave the height slightly too tall (a faint
    // scrollbar). Re-measure once fonts settle. (?. short-circuits the whole chain
    // where FontFaceSet is absent, e.g. jsdom.)
    document.fonts?.ready.then(() => measure());
    return () => window.removeEventListener("resize", measure);
  }, [measure]);

  const dims = useMemo(() => fitAspectClamped(avail.w, avail.h), [avail]);

  // Re-arm the transition one frame after the initial measure or a resize, so the
  // next mode toggle eases but the size change that just committed didn't.
  useEffect(() => {
    if (dims && !animateHeight) {
      const id = requestAnimationFrame(() => setAnimateHeight(true));
      return () => cancelAnimationFrame(id);
    }
  }, [dims, animateHeight]);

  return { wrapRef, dims, animateHeight };
}
