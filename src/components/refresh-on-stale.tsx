"use client";

import { useEffect } from "react";

import { apiClient } from "@/lib/api";
import { BUILD } from "@/lib/build-identity";
import { computeUpdateTier, type LiveVersion } from "@/lib/update-tier";

// One auto-reload, then quiet for this long — a backstop against a reload
// loop if /api/version ever flaps. The normal path needs no cooldown: a
// reload makes the tab current, so the next check finds nothing stale.
const RELOAD_COOLDOWN_MS = 60_000;
const RELOAD_AT_KEY = "is-app:home-refreshed-at";

// Mounted on a safe-refresh point (the home page), where the member has no
// in-process work at the moment of mount. Checks the live version once and,
// if the tab is stale, hard-reloads immediately — bypassing the patch hold,
// because on home there is no work to protect and no nag cost. Renders
// nothing. See docs/strategy-deployment.md.
export function RefreshOnStale() {
  useEffect(() => {
    // The reload is safe only before the member interacts. The check is an
    // async fetch, so a keystroke can land in that window; if it does, bail
    // and leave the update to the banner.
    let interacted = false;
    const markInteracted = () => {
      interacted = true;
    };
    window.addEventListener("keydown", markInteracted, { once: true });

    const check = async () => {
      if (interacted) return;
      const lastReload = Number(window.sessionStorage.getItem(RELOAD_AT_KEY) ?? 0);
      if (Date.now() - lastReload < RELOAD_COOLDOWN_MS) return;

      try {
        const res = await apiClient.api.version.$get();
        if (!res.ok) return;
        const live: LiveVersion = await res.json();
        if (interacted) return; // a keystroke may have landed during the fetch
        if (computeUpdateTier(BUILD, live) !== null) {
          window.sessionStorage.setItem(RELOAD_AT_KEY, String(Date.now()));
          window.location.reload();
        }
      } catch {
        // A failed check is a non-event; the banner is the fallback.
      }
    };

    void check();
    return () => window.removeEventListener("keydown", markInteracted);
  }, []);

  return null;
}
