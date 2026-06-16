import { useCallback, useEffect, useRef, useState } from "react";

import { apiClient } from "@/lib/api";
import { BUILD } from "@/lib/build-identity";
import { computeUpdateTier, isPatchDue, type LiveVersion, type UpdateTier } from "@/lib/update-tier";

// Holds the ms timestamp of the last patch-banner dismissal — the
// "once per 12h" memory that survives reloads.
const PATCH_DISMISSED_KEY = "is-app:update-patch-dismissed-at";

const readPatchDismissal = (): number | null => {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(PATCH_DISMISSED_KEY);
  const parsed = raw ? Number(raw) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
};

export type NewVersionState = {
  // The tier to surface, or null when nothing should show.
  tier: UpdateTier | null;
  // Dismiss the current banner. A patch dismissal is remembered for 12h;
  // a feature dismissal lasts the session. No-op for urgent — that banner
  // renders no dismiss control.
  dismiss: () => void;
};

export function useNewVersionAvailable(): NewVersionState {
  const [live, setLive] = useState<LiveVersion | null>(null);
  const [featureDismissed, setFeatureDismissed] = useState(false);
  const [patchDismissedAt, setPatchDismissedAt] = useState<number | null>(null);
  const inFlight = useRef(false);

  // Hydrate the patch cooldown once, client-side, so render never reads
  // localStorage (no SSR mismatch).
  useEffect(() => {
    setPatchDismissedAt(readPatchDismissal());
  }, []);

  useEffect(() => {
    let cancelled = false;

    const check = async () => {
      // Switching back to a tab can fire focus and visibilitychange
      // together; one in-flight poll at a time is enough.
      if (inFlight.current) return;
      inFlight.current = true;
      try {
        const res = await apiClient.api.version.$get();
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setLive(data);
      } catch {
        // A failed background poll is a non-event: keep the last known
        // state and retry on the next focus.
      } finally {
        inFlight.current = false;
      }
    };

    void check(); // on mount

    // Focus is when the member returns to a tab and is about to act on
    // possibly-stale code. No interval timer — checks are free while the
    // tab is backgrounded (docs/strategy-deployment.md).
    const onFocus = () => void check();
    const onVisible = () => {
      if (document.visibilityState === "visible") void check();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  const rawTier = live ? computeUpdateTier(BUILD, live) : null;

  // Resolve what to actually show. Within a session the tier only ever
  // climbs (deploys don't un-ship), so an escalation re-surfaces the
  // banner past a lower-tier dismissal: a dismissed patch yields to a
  // feature, a dismissed feature yields to an urgent.
  let tier: UpdateTier | null = null;
  if (rawTier === "urgent") {
    tier = "urgent";
  } else if (rawTier === "feature") {
    // A second feature in the same un-reloaded session stays hidden until
    // reload — rare, and reloading is the resolution anyway.
    tier = featureDismissed ? null : "feature";
  } else if (rawTier === "patch" && isPatchDue(BUILD.builtAt, Date.now(), patchDismissedAt)) {
    tier = "patch";
  }

  const dismiss = useCallback(() => {
    if (rawTier === "patch") {
      const ts = Date.now();
      if (typeof window !== "undefined") {
        window.localStorage.setItem(PATCH_DISMISSED_KEY, String(ts));
      }
      setPatchDismissedAt(ts);
    } else if (rawTier === "feature") {
      setFeatureDismissed(true);
    }
  }, [rawTier]);

  return { tier, dismiss };
}
