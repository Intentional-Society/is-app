// Shared by NavigationHistory (writer), BreadcrumbLink (reader), and
// clearNavHistory (reset, called from the side-nav menu).
export const HISTORY_KEY = "isweb-nav-history";

// Short cap: BreadcrumbLink only ever inspects the top of the stack, so
// a large history adds no value and just bloats sessionStorage.
export const HISTORY_LIMIT = 10;

// Wipes the recorded in-app history. Called from the side-nav menu
// links: a menu jump is a "switch sections", not a "drill in", so the
// new section's BreadcrumbLink should land on its fallback, not point
// back at the page the user just left.
export function clearNavHistory(): void {
  try {
    window.sessionStorage.removeItem(HISTORY_KEY);
  } catch {
    // sessionStorage may be blocked; the breadcrumb already degrades to
    // its fallback in that case, so there's nothing to clean up.
  }
}

// All "← <label>" strings live here. EXACT wins by direct lookup;
// PREFIX is a fall-through for dynamic detail pages, which use the
// parent-section label since the entity's display name isn't on hand
// at render time. PREFIX entries are checked in declaration order, so
// list longer prefixes first.
const EXACT_LABELS: Record<string, string> = {
  "/": "Home",
  "/members": "Directory",
  "/myweb": "My web",
  "/programs": "Programs",
  "/me": "My page",
  "/invites": "Invites",
  "/about": "About",
  "/admin": "Admin",
  "/admin/programs": "Admin programs",
};
const PREFIX_LABELS: Record<string, string> = {
  "/admin/programs/": "Admin programs",
  "/programs/": "Programs",
  "/members/": "Member",
};

export function labelForPath(pathname: string): string {
  const direct = EXACT_LABELS[pathname];
  if (direct) return direct;
  for (const [prefix, label] of Object.entries(PREFIX_LABELS)) {
    if (pathname.startsWith(prefix)) return label;
  }
  return "Back";
}
