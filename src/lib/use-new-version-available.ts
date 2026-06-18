import { useCallback, useEffect, useRef, useState } from "react";

import { apiClient } from "@/lib/api";
import { BUILD } from "@/lib/build-identity";
import {
  computeUpdateTier,
  FEATURE_INITIAL_HOLD_MS,
  isUpdateDue,
  type LiveVersion,
  PATCH_INITIAL_HOLD_MS,
  type UpdateTier,
} from "@/lib/update-tier";

// localStorage keys holding the ms timestamp of each tier's last banner
// dismissal — the "remind me again in REPEAT_HOLD_MS" memory that survives
// reloads. Urgent has none; it can't be dismissed.
const DISMISSED_KEY = {
  patch: "is-app:update-patch-dismissed-at",
  feature: "is-app:update-feature-dismissed-at",
} as const;

const readDismissal = (key: string): number | null => {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(key);
  const parsed = raw ? Number(raw) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
};

const writeDismissal = (key: string, ts: number): void => {
  if (typeof window !== "undefined") {
    window.localStorage.setItem(key, String(ts));
  }
};

export type NewVersionState = {
  // The tier to surface, or null when nothing should show.
  tier: UpdateTier | null;
  // Dismiss the current banner. A patch or feature dismissal is remembered
  // for REPEAT_HOLD_MS, after which the banner returns. No-op for urgent —
  // that banner renders no dismiss control.
  dismiss: () => void;
};

export function useNewVersionAvailable(): NewVersionState {
  const [live, setLive] = useState<LiveVersion | null>(null);
  const [patchDismissedAt, setPatchDismissedAt] = useState<number | null>(null);
  const [featureDismissedAt, setFeatureDismissedAt] = useState<number | null>(null);
  const inFlight = useRef(false);

  // Hydrate the dismissal cooldowns once, client-side, so render never reads
  // localStorage (no SSR mismatch).
  useEffect(() => {
    setPatchDismissedAt(readDismissal(DISMISSED_KEY.patch));
    setFeatureDismissedAt(readDismissal(DISMISSED_KEY.feature));
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
  const now = Date.now();

  // Resolve what to actually show. Within a session the tier only ever
  // climbs (deploys don't un-ship), so an escalation re-surfaces the
  // banner past a lower-tier dismissal: a dismissed patch yields to a
  // feature, a dismissed feature yields to an urgent.
  let tier: UpdateTier | null = null;
  if (rawTier === "urgent") {
    tier = "urgent";
  } else if (rawTier === "feature" && isUpdateDue(BUILD.builtAt, now, FEATURE_INITIAL_HOLD_MS, featureDismissedAt)) {
    // Held until the build clears the feature hold, then shown; a dismissal
    // quiets it for REPEAT_HOLD_MS, after which it returns — same cadence as
    // patch.
    tier = "feature";
  } else if (rawTier === "patch" && isUpdateDue(BUILD.builtAt, now, PATCH_INITIAL_HOLD_MS, patchDismissedAt)) {
    tier = "patch";
  }

  const dismiss = useCallback(() => {
    const ts = Date.now();
    if (rawTier === "patch") {
      writeDismissal(DISMISSED_KEY.patch, ts);
      setPatchDismissedAt(ts);
    } else if (rawTier === "feature") {
      writeDismissal(DISMISSED_KEY.feature, ts);
      setFeatureDismissedAt(ts);
    }
  }, [rawTier]);

  return { tier, dismiss };
}
