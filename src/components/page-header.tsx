import type { ReactNode } from "react";

import { BreadcrumbLink } from "@/components/breadcrumb-link";
import { cn } from "@/lib/utils";

// The unified top row: the page title shares one horizontal band with
// the fixed home icon (left) and menu (right), with the breadcrumb at
// the right edge beside the menu. Pages render this as the first child
// of a `main` with `pt-3`, which lands the title's text line level
// with the icon glyphs (icon boxes are p-3 + size-8 → y 12-44). The
// row's px-6, on top of the main's px-8, keeps both ends clear of the
// fixed corner icons (their boxes end 44px from the viewport edge).
export function PageHeader({
  title,
  hint,
  subtitle,
  right,
  fallback = "/",
  className,
}: {
  title: string;
  /** Rendered beside the h1 (e.g. a HelpHint). */
  hint?: ReactNode;
  /** Hangs under the h1 inside the band (e.g. "Member since 2026"). */
  subtitle?: ReactNode;
  /** Replaces the default breadcrumb (e.g. the admin "← Admin" link). */
  right?: ReactNode;
  /** Breadcrumb fallback route when no nav history exists. */
  fallback?: string;
  className?: string;
}) {
  return (
    <div className={cn("flex w-full items-baseline justify-between px-6", className)}>
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold">{title}</h1>
          {hint}
        </div>
        {subtitle}
      </div>
      {right ?? <BreadcrumbLink fallback={fallback} />}
    </div>
  );
}
