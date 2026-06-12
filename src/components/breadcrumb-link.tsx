"use client";

import type { UrlObject } from "node:url";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { HISTORY_KEY, labelForPath } from "@/lib/route-labels";

type Props = {
  fallback: string;
  className?: string;
};

// shrink-0 + nowrap: the link sits in tight justify-between title rows
// and must not wrap "← Label" onto two lines when the title is long.
const DEFAULT_CLASSES = "shrink-0 whitespace-nowrap text-base text-muted-foreground hover:text-foreground";

// History-aware breadcrumb link. On first render (and on the server)
// it shows the per-page fallback so SSR and hydration agree; a client
// effect then upgrades it to "← <previous>" when NavigationHistory has
// an in-app entry recorded for the current pathname. The label for
// both states comes from labelForPath, so the route → label map is the
// single source of truth.
export function BreadcrumbLink({ fallback, className }: Props) {
  const pathname = usePathname();
  const [previous, setPrevious] = useState<string | null>(null);

  useEffect(() => {
    try {
      const raw = window.sessionStorage.getItem(HISTORY_KEY);
      if (!raw) {
        setPrevious(null);
        return;
      }
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        setPrevious(null);
        return;
      }
      for (let i = parsed.length - 1; i >= 0; i--) {
        const entry = parsed[i];
        if (typeof entry === "string" && entry !== pathname) {
          setPrevious(entry);
          return;
        }
      }
      setPrevious(null);
    } catch {
      setPrevious(null);
    }
  }, [pathname]);

  // typedRoutes requires a known route or a UrlObject — the in-app
  // pathname stack holds arbitrary strings, so we hand Link a UrlObject.
  const target = previous ?? fallback;
  const href: UrlObject = { pathname: target };
  return (
    <Link href={href} className={className ?? DEFAULT_CLASSES}>
      ← {labelForPath(target)}
    </Link>
  );
}
