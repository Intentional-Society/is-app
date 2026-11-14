// Lane values shared by make-lane-inside-worktree.mjs, which writes them to
// .env.local, and ensure-supabase.mjs, which checks them on each start.

// site_url and the redirect allow-list in supabase/config.toml point at the
// dev server on 3000; a lane shifts them to its own dev port. Returns null
// when config.toml lacks either key.
export function laneAuthUrls(configText, devPort) {
  const site = configText.match(/^site_url\s*=\s*"([^"]*)"/m);
  const list = configText.match(/^additional_redirect_urls\s*=\s*\[([^\]]*)\]/m);
  if (!site || !list) return null;
  const shift = (url) => url.replace(":3000", `:${devPort}`);
  return {
    SUPABASE_AUTH_SITE_URL: shift(site[1]),
    SUPABASE_AUTH_ADDITIONAL_REDIRECT_URLS: [...list[1].matchAll(/"([^"]*)"/g)].map((m) => shift(m[1])).join(","),
  };
}
