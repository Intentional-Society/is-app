"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

import { HISTORY_KEY, HISTORY_LIMIT } from "@/lib/page-titles";

// Records each in-app pathname into a sessionStorage-backed stack so
// BreadcrumbLink can render history-aware "← <previous>" links.
// Mounted once near the top of the tree in app/layout.tsx.
export function NavigationHistory() {
  const pathname = usePathname();

  useEffect(() => {
    try {
      const raw = window.sessionStorage.getItem(HISTORY_KEY);
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      const stack: string[] = Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
      const last = stack[stack.length - 1];
      if (last === pathname) return;
      const prev = stack[stack.length - 2];
      if (prev === pathname) {
        // Back navigation (breadcrumb click or browser back): pop
        // rather than push so the stack stays a reverse-chronological
        // record and clicking "back" from the destination doesn't
        // bounce us right back to where we just left.
        stack.pop();
      } else {
        stack.push(pathname);
        while (stack.length > HISTORY_LIMIT) stack.shift();
      }
      window.sessionStorage.setItem(HISTORY_KEY, JSON.stringify(stack));
    } catch {
      // sessionStorage can be blocked (private browsing, sandboxed
      // iframes); when it is, BreadcrumbLink quietly falls back to the
      // per-page default link.
    }
  }, [pathname]);

  return null;
}
