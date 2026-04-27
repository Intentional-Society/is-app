# Security Strategy

This doc explains the security headers we serve from `next.config.ts` — what each one does, why it's set the way it is, and what would make us reconsider. Headers are applied to every route via Next's `headers()` config; they are part of the production response and we accept that they also constrain `next dev`.

## Threat model in one paragraph

Intentional Society is an authenticated app for a small membership network. The realistic risks are: (1) XSS via dependency compromise or a careless `dangerouslySetInnerHTML`, (2) clickjacking of authenticated users, (3) accidental data leakage through the `Referer` header to third parties, and (4) network-level downgrades. The headers below address those four directly. We are not trying to defend against a sophisticated targeted attacker — if our supply chain is compromised end-to-end, headers won't save us.

## `X-Frame-Options: DENY`

Prevents any site from loading our app in an `<iframe>`. This blocks classic clickjacking against authenticated members.

`Content-Security-Policy: frame-ancestors 'none'` (below) is the modern equivalent and supersedes XFO in any browser that supports CSP. We keep both as belt-and-suspenders for ancient browsers and well-meaning intermediaries that strip CSP. There is no downside — they agree.

Reconsider if we ever need to embed the app inside a partner site or an internal admin shell.

## `X-Content-Type-Options: nosniff`

Tells browsers to trust the `Content-Type` we send and not guess. The classic exploit is uploading a file labeled `image/png` that is actually HTML/JS, then tricking the browser into rendering it as a document. Cheap, no downside. Always on.

## `Referrer-Policy: strict-origin-when-cross-origin`

When a member clicks a link to a third party, only the origin (`https://app.intentionalsociety.org`) is sent — never the path or query string. Same-origin navigations still get the full URL (needed for analytics, logging, and back-button heuristics). HTTP downgrades send no referrer at all.

The stricter alternative (`no-referrer` or `same-origin`) breaks legitimate things — partner sites use referrer for attribution, and OAuth flows sometimes rely on it. `strict-origin-when-cross-origin` is the modern browser default; we set it explicitly so it survives proxies that strip defaults.

## `Permissions-Policy: camera=(), microphone=(), geolocation=()`

Disables three powerful browser APIs we don't use. Even though our own code doesn't call `getUserMedia`, this stops a compromised dependency or an embedded `<iframe>` from prompting a member for camera access on our origin.

We could disable more (`payment`, `usb`, `interest-cohort`, `screen-wake-lock`, etc.) for defense-in-depth. We've kept the list short because each entry is a future-self trap: the day someone wants to add a "scan QR code to join an event" feature, the camera will silently fail to initialize and the failure mode is non-obvious. Add capabilities to this list when we know we're not going to use them; resist the urge to disable everything pre-emptively.

## `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`

Tells browsers to refuse HTTP for `app.intentionalsociety.org` and every subdomain for two years. After the first successful HTTPS visit, the browser will not let the user click through a cert error or accept a downgrade.

Three flags, three considerations:

- **`max-age=63072000`** (two years) is the value the HSTS preload list requires. Anything shorter is fine but won't qualify for preload.
- **`includeSubDomains`** extends the policy to every `*.intentionalsociety.org`. This is what we want — a forgotten `staging.intentionalsociety.org` running plain HTTP would otherwise be a phishing vector — but it is a commitment. Any future subdomain must serve valid HTTPS or it becomes unreachable to anyone who has visited the app.
- **`preload`** is the load-bearing one. The directive itself does nothing until we actually submit `intentionalsociety.org` to [hstspreload.org](https://hstspreload.org). Once submitted and accepted, the policy is baked into Chrome/Firefox/Safari and cannot be quickly removed — rollback takes months. **We have not submitted yet.** The directive is in the header to signal intent and to make sure the long `max-age` and `includeSubDomains` are correct before we commit.

Reconsider `preload` only after we've inventoried every subdomain and confirmed each one terminates TLS correctly.

## Content-Security-Policy

CSP is the only header here that meaningfully constrains XSS. The directives below are fallback-aware: anything not explicitly listed inherits from `default-src 'self'`.

### `default-src 'self'`

The catch-all. Anything we don't override is restricted to the same origin.

### `script-src 'self' 'unsafe-inline'`

Same origin plus inline `<script>` tags.

`'unsafe-inline'` is the weakest link in this CSP. It exists because Next's App Router emits inline hydration scripts (`__NEXT_DATA__`, route announcer, the flight payload), and Next does not currently emit them with a stable nonce or hash. With `'unsafe-inline'` present, CSP cannot block an injected `<script>injected()</script>` — so this header is mostly defense against external script loads, not against XSS in our own HTML.

The fix is a nonce-based CSP applied via Next middleware: generate a per-request nonce, attach it to every framework script via `headers()` plumbing, and replace `'unsafe-inline'` with `'nonce-...' 'strict-dynamic'`. This is a meaningful change (middleware runs on every request, has cold-start cost, and needs careful testing of the streamed HTML) so it is tracked separately as a follow-up.

`'unsafe-eval'` is added to `script-src` **only when `NODE_ENV !== "production"`**, because React Refresh (HMR) under `next dev` uses `eval`/`new Function` to apply hot updates. Production Next 15 has no such requirement, so the production CSP is strictly stronger than the dev CSP. The branch is a single ternary in `next.config.ts` keyed on `process.env.NODE_ENV`, evaluated at build time.

The asymmetry means dev cannot catch a CSP regression that only fires in production. The mitigation is the rule in the "Updating these headers" section below: verify CSP changes in a deployed preview, not just locally.

### `style-src 'self' 'unsafe-inline'`

Same shape as `script-src`. `'unsafe-inline'` is required because Tailwind v4, Next's font loader, and several Radix-derived components inject inline `style` attributes for layout calculations. The XSS risk from inline styles is much lower than from inline scripts (no JS execution, limited to CSS-injection tricks), so we accept this without a follow-up.

### `connect-src` (env-conditional)

Outbound XHR/fetch/WebSocket destinations.

- **Production:** `connect-src 'self' https://*.supabase.co`
- **Dev:** `connect-src 'self' https://*.supabase.co http://127.0.0.1:54321`

The two entries:

- **`'self'`** covers our Hono API routes (all database access), the Sentry tunnel at `/monitoring` (configured via `tunnelRoute` in `next.config.ts`), and the next-axiom client proxy at `/_axiom/*`. Both observability tools route browser telemetry through our own origin, which is why this list is short.
- **`https://*.supabase.co`** is required because Supabase Auth (GoTrue) is the only Supabase service we call directly from the browser. The login/signup forms call `supabase.auth.signInWith*` and `updateUser`; the `AuthProvider` subscribes to `onAuthStateChange`, which performs background token refreshes against `https://<project>.supabase.co/auth/v1/token`. Database queries do **not** go to Supabase from the browser — they go through Hono.

The dev-only `http://127.0.0.1:54321` entry exists because `npm run dev` points the browser auth client at the local Supabase stack (`NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321`). Without it in dev, every login/signup/token-refresh call would be CSP-blocked. The branch is keyed on `process.env.NODE_ENV` so the URL never appears in production response headers.

Notably absent in production:

- **`wss://*.supabase.co`** — we don't use Supabase Realtime (no `.channel()` / `.subscribe()` anywhere in `src/`), and the JS client only opens a WebSocket when Realtime is explicitly invoked. Add it back if/when we adopt Realtime.
- **`https://o*.ingest.sentry.io`, `https://js.sentry-cdn.com`** — unnecessary because of the Sentry tunnel.
- **`https://*.axiom.co`** — unnecessary because next-axiom proxies through `/_axiom/*`.

If we ever route auth through our own backend (server-side endpoints that proxy GoTrue), `https://*.supabase.co` can also be removed and `connect-src` collapses to `'self'` — but there are no concrete plans to do this.

### `img-src 'self' data: blob: https:`

Same origin, plus `data:` URIs (used by inlined SVGs and small icons), `blob:` URLs (used by client-side image previews), and any HTTPS host. The wildcard is permissive — an attacker who controls page HTML could exfiltrate a small amount of data via image URLs — but member avatars and OAuth profile pictures come from many origins (Supabase storage, Google, GitHub, etc.), and enumerating them is high-maintenance.

Reconsider narrowing if we move to a single avatar host or if a CSP report ever shows an unexpected image source.

### `font-src 'self'`

Fonts only from our own origin. We use `next/font/google` (Gudea, Ovo) which downloads the font files at build time and serves them from `_next/static/...`, so `'self'` is sufficient. There is no need to allow `fonts.gstatic.com`.

### `worker-src 'self' blob:`

Workers can be loaded from our own origin, plus `blob:` URLs constructed in JS. We don't instantiate workers in our own code, but `blob:` is allowed so that Sentry session replay (which spawns its replay worker from a `Blob`) will work the moment we enable it, without a separate CSP change racing the feature flag.

The cost of allowing `blob:` is that an attacker who already has script execution can spawn a worker from a `Blob` they constructed — but at that point the attacker already has script execution, so the worker doesn't meaningfully widen the blast radius. Cross-origin worker URLs are still blocked.

### `object-src 'none'`

Blocks `<object>`, `<embed>`, and `<applet>` entirely — there is no legitimate plugin content in this app, and these elements are a classic XSS escape hatch. CSP would already fall back to `default-src 'self'`, but `'none'` is stricter and clearer about intent.

### `base-uri 'self'`

Restricts what `<base href="...">` can point to. Without this directive, an attacker who lands a single injected tag (e.g., via a stored XSS in a name field) can rewrite every relative URL on the page to point to their server, exfiltrating subsequent navigations and form posts. With `'self'`, the injected `<base>` is ignored.

### `form-action 'self'`

Forms can only submit to our own origin. All forms in the app are either `onSubmit`-driven (login, signup, welcome) or use a Next.js Server Action (`<form action={signOut}>` on the home page); both stay same-origin, so this is purely defensive against future changes that introduce cross-origin form posts.

### `frame-ancestors 'none'`

Nobody can embed us in an iframe. This is the modern replacement for `X-Frame-Options: DENY` — both are set; whichever the browser supports wins.

### `upgrade-insecure-requests`

Tells the browser to silently rewrite any `http://` subresource to `https://` before fetching. This is a safety net: if a future commit hardcodes `http://example.com/img.png`, the browser will fetch the HTTPS variant rather than triggering a mixed-content failure or — worse — succeeding over plain HTTP. Cheap belt-and-suspenders that pairs with HSTS.

## What we don't set (and why)

- **`Cross-Origin-Opener-Policy` / `Cross-Origin-Embedder-Policy` / `Cross-Origin-Resource-Policy`** — These enable browser process isolation (Spectre mitigation, `SharedArrayBuffer`). We don't need `SharedArrayBuffer`, and turning these on can break OAuth popups and third-party embeds. Skipped intentionally.
- **CSP report endpoint** — `report-to` / `report-uri` would let us see what the policy is blocking in the wild. Worth wiring up if we get a real CSP regression; not worth the noise floor today.

## Updating these headers

Three rules:

1. **Add to `connect-src` only when a real request is being blocked.** Don't pre-emptively whitelist a service we might integrate with.
2. **Verify in the browser, not just in tests.** CSP violations appear in the DevTools console; functional and e2e tests almost never catch them because Playwright runs against a permissive headless Chromium. Open the deployed site, look for `Refused to ...` errors, fix them.
3. **Loosening is a one-way ratchet.** Anything added here is harder to remove than to add — every addition needs a one-line justification in the comment next to it, like the existing `connect-src` comment.
