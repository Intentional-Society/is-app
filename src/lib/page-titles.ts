// Single source of truth for page names. A route's `title` feeds its
// document <title> (through the root layout's "IS Web: %s" template) via
// `titleFor`, called from each page's metadata; the breadcrumb back link
// uses `crumb` when set — else the title — via `labelForPath`. Adding a
// page = one entry here plus a `titleFor("/route")` in its metadata.
//
// Imported by both server pages (metadata) and the client BreadcrumbLink,
// so it must stay free of server-only deps.

export type PageTitle = {
  // Document <title>, before the "IS Web: %s" prefix the layout adds.
  title: string;
  // Terser "← <crumb>" back-link label; defaults to `title` when omitted.
  // Set it only where the back link should read shorter than the title.
  crumb?: string;
};

// `satisfies` (not `: Record<…>`) keeps the literal keys, so titleFor's
// argument is type-checked against the real route set — a typo'd path is
// a compile error, not a runtime surprise.
export const PAGE_TITLES = {
  "/members": { title: "Member directory", crumb: "Directory" },
  "/myweb": { title: "My web" },
  "/programs": { title: "Programs" },
  "/me": { title: "My page" },
  "/invites": { title: "Invites" },
  "/about": { title: "About" },
  "/intentions": { title: "Current intentions" },
  "/admin": { title: "Admin" },
  "/admin/members": { title: "Admin · Members", crumb: "Admin members" },
  "/admin/programs": { title: "Admin · Programs", crumb: "Admin programs" },
  "/admin/invites": { title: "Admin · Invites", crumb: "Admin invites" },
  "/admin/signins": { title: "Admin · Sign-ins", crumb: "Admin sign-ins" },
  "/signin": { title: "Sign in" },
  "/signup": { title: "Sign up" },
  "/forgot-password": { title: "Forgot password" },
  "/auth/reset-password": { title: "Set new password" },
  "/welcome/agreements": { title: "Welcome · Agreements" },
  "/welcome/profile": { title: "Welcome · Profile" },
  "/welcome/programs": { title: "Welcome · Programs" },
  "/colors": { title: "Theme palette" },
} satisfies Record<string, PageTitle>;

// The page's own document title, fed into its metadata export. The home
// page is intentionally absent: it keeps the brand (the layout's
// title.default, no prefix), so it never calls titleFor.
export function titleFor(pathname: keyof typeof PAGE_TITLES): string {
  return PAGE_TITLES[pathname].title;
}

// Detail pages set their document title dynamically (the entity name, via
// generateMetadata), but the breadcrumb can't know that name when it
// renders, so it falls back to the parent-section label. Longest prefix
// first.
const CRUMB_PREFIXES: ReadonlyArray<readonly [string, string]> = [
  ["/admin/programs/", "Admin programs"],
  ["/programs/", "Programs"],
  ["/members/", "Member"],
];

// Breadcrumb back-link label for an arbitrary target path (the previous
// entry in the nav stack, or a page's fallback): the dictionary's
// crumb/title for known routes, the parent-section label for dynamic
// detail pages, "Home" for the root, and "Back" as a last resort.
export function labelForPath(pathname: string): string {
  if (pathname === "/") return "Home";
  const entry = (PAGE_TITLES as Record<string, PageTitle>)[pathname];
  if (entry) return entry.crumb ?? entry.title;
  for (const [prefix, label] of CRUMB_PREFIXES) {
    if (pathname.startsWith(prefix)) return label;
  }
  return "Back";
}

// ── Nav-history storage: the breadcrumb's referrer stack ──────────────
// Written by NavigationHistory, read by BreadcrumbLink, cleared by the
// side-nav menu (a section jump shouldn't leave a stale "back" target).
export const HISTORY_KEY = "isweb-nav-history";

// Short cap: BreadcrumbLink only inspects the top of the stack, so a
// large history adds no value and just bloats sessionStorage.
export const HISTORY_LIMIT = 10;

export function clearNavHistory(): void {
  try {
    window.sessionStorage.removeItem(HISTORY_KEY);
  } catch {
    // sessionStorage may be blocked; the breadcrumb already degrades to
    // its fallback in that case, so there's nothing to clean up.
  }
}
