# Deployment Strategy — Continuous Deployment During Active Sessions

We deploy to production continuously: every merge to `main` ships immediately while
members may have the app open. This document describes how a live deploy stays
invisible to an active session, and how we surface a new version to a member who
would otherwise keep running old code indefinitely.

The architecture rationale for each component lives in
`docs/architecture-appstack.md`; the schema/API compatibility mechanics live in
`docs/strategy-committing.md`. This doc is the single place that ties them together
around one question: *what happens to a member who is using the app at the exact
moment we deploy?*

## Core stance: stateless and backward-compatible at every layer

Continuous deployment mid-session is safe because no layer holds session-critical
state that a deploy can pull out from under the user.

- **Atomic cutover (Vercel).** A merge to `main` builds a new deployment, then flips
  the production alias to it atomically. In-flight requests on old serverless
  instances drain on their own; new requests hit the new deployment. There is no
  "restart" window — the serverless model has no long-lived process to bounce. If
  the production build fails (including the `drizzle-kit migrate` step that runs
  first), the alias never flips and the previous deployment keeps serving traffic
  (`docs/doc-vercel.md`).
- **Auth continuity (stateless JWT).** The Supabase JWT lives client-side; Hono
  verifies it statelessly in middleware. Token refresh happens in the browser
  *directly against Supabase GoTrue*, independent of our deployments. A deploy
  landing mid-session never logs anyone out and never invalidates a token, because
  there is no server-side session to lose.
- **API compatibility (expand-contract).** An already-loaded tab talking to the
  freshly deployed API keeps working because API changes follow the expand-contract
  pattern: add the new shape alongside the old, migrate clients, then remove the old
  one — never expand and contract in the same deploy. See `docs/strategy-committing.md`.
- **Database migrations (forward-only, pre-cutover).** Migrations run in the
  production build command *before* `next build`, so the schema is updated before the
  new code is live. The only window to reason about is "old code vs. new schema,"
  which expand-contract makes the safe direction. See `docs/strategy-committing.md`.
- **Client data (stale-while-revalidate).** TanStack Query keeps rendering cached
  data and refetches in the background, so as the backend changes underneath, the UI
  degrades to "slightly stale" rather than "broken."

The rest of this doc covers the one layer the list above doesn't fully solve on its
own: the **front-end bundle** a member already downloaded.

## Version skew: Vercel Skew Protection

When a deploy lands while a member has a tab open, that tab is running the *old*
JavaScript bundle. If it then requests an asset or runs a Server Action against the
*new* deployment, the versions disagree — "version skew." Vercel Skew Protection
solves this by version-locking a session to the deployment that served its initial
page load.

**How it pins.** For framework-managed requests — static assets/chunks, client-side
route-transition data fetches, Server Actions, and prefetches — Next.js attaches the
deployment ID (as a `?dpl=` query param or `x-deployment-id` header). Vercel routes
those requests back to the originating deployment, so an open tab keeps getting a
self-consistent old version.

**Configuration.** Skew Protection is enabled on the project (default for projects
on supported frameworks created after 2024-11-19). **Max Age is 12 hours** — a tab
older than that loses its pin. See `docs/doc-vercel.md` for the dashboard setting.

**The built-in document-navigation reload (our passive baseline).** Skew Protection
deliberately does *not* pin full-page document navigations — a hard refresh, typing
the URL, or opening a link in a new tab fetches the *latest* production deployment.
When the framework detects the version mismatch on that load, it triggers a full page
reload onto the new version. So a member who closes and reopens the tab, or hard-
refreshes, lands on the latest version with no work from us.

**What Skew Protection does *not* do** — and why a passive baseline isn't enough:

1. It doesn't *tell* the member a new version exists.
2. It doesn't move an already-open session onto new code. In-app navigation via
   `<Link>` is a framework-managed request, so it stays *pinned to the old
   deployment*. A member who clicks around the app for hours via SPA navigation never
   triggers the built-in document-navigation reload and never sees fixes shipped in
   the meantime.
3. The pin lapses past the 12-hour Max Age, after which a long-idle tab is
   unprotected again.

We deliberately do **not** set the `__vdpl` cookie (the "extend Skew Protection for
long-lived sessions" pattern that pins document navigations too). Setting it would
disable the built-in document-navigation reload, which is the baseline we rely on.

## The new-version signal

To close gap #2 above, the app actively detects a newer production deployment and
surfaces a member-initiated reload. This is the "an update is available" banner.

### Detection

Two values, compared:

- **The running tab's identity**, baked into the client bundle at build time.
  `next.config.ts` inlines `NEXT_PUBLIC_BUILD_ID` from `VERCEL_DEPLOYMENT_ID`
  (falling back to `"dev"` locally). This is frozen — it is the deployment the open
  tab is running.
- **The current production identity**, fetched at runtime. `GET /api/version`
  (unauthenticated, in the Hono API at `src/server/api.ts`) returns
  `{ id: process.env.VERCEL_DEPLOYMENT_ID ?? "dev", critical: process.env.CRITICAL_UPDATE === "1" }`,
  read per request.

The detection works *because of* a Skew Protection detail: the framework pins
framework-managed requests, but **not custom `fetch()` calls**. The poll to
`/api/version` is a plain client `fetch`, so it is not pinned — it resolves to the
*current production* deployment and returns that deployment's ID, not the session's.
When `data.id !== NEXT_PUBLIC_BUILD_ID`, a newer deployment is live. (Do not add
`?dpl=` or an `x-deployment-id` header to this fetch, or it would pin and always
report the session's own ID.)

### When we poll

`useNewVersionAvailable` checks on mount, on window `focus`, and on
`visibilitychange` → visible. There is no short interval timer. Focus is the moment
the member returns to the tab and is about to act on possibly-stale code — exactly
when a check is worth doing, and free while the tab is backgrounded. (This mirrors
the instinct behind TanStack Query's `refetchOnWindowFocus`, which the app already
relies on.)

### What the member sees

- **Normal deploy:** a dismissible banner — *"A new version is available — Reload."*
  Reload calls `window.location.reload()`, which is a full document navigation and so
  pulls the latest production assets. The banner is persistent, not a modal: the
  member finishes what they're doing and reloads at a safe stopping point.
- **Critical deploy** (`critical: true`): a non-dismissible banner — *"An important
  update is ready. Reload to continue."* It is still member-initiated (one click,
  never automatic) but cannot be dismissed. A maintainer marks a deploy critical by
  setting the `CRITICAL_UPDATE` env var on the production deployment (e.g. when
  shipping a security fix); unset means `false`.

The banner is a client component mounted in the root layout. It reuses the visual
language of `src/components/help-hint.tsx` (border, `bg-background`, muted text) so
it reads as part of the app, not a system chrome intrusion.

### Why never force-refresh

The pattern of auto-reloading the page the instant a new deploy is detected is
rejected. A forced reload discards unsaved client state, and this app is mostly input
surfaces where that is real damage:

- Profile **Edit mode** — an unsaved bio / keywords
- The **My Web** canvas and relation dialog (`src/app/myweb/`)
- The **welcome / onboarding** flow mid-step
- The **feedback** form

Getting a member onto the latest build thirty seconds sooner is not worth deleting a
half-written profile. Even the critical path stays member-initiated — we make the
prompt impossible to ignore (non-dismissible) rather than impossible to avoid
(automatic).

## Relationship to the changelog

`NEXT_PUBLIC_BUILD_ID` is the *deployment identity* and drives the update banner.
`appVersion` in `src/lib/changelog.ts` is a different thing: the date of the newest
*member-facing* changelog entry, shown on `/about`. Most deploys (bug fixes, infra,
the very fixes we most want pushed out) do not bump `appVersion`. The banner must key
on deployment ID, not the changelog date, or it would miss exactly the deploys that
matter most.

## Rejected alternatives

- **Automatic force-refresh** — discards unsaved work; see above.
- **Server push (SSE / WebSocket "new deploy, reload" broadcast)** — needs a
  persistent connection per client. Supabase Realtime is deliberately unused
  (`next.config.ts`), and at this scale a focus-triggered poll delivers the same
  outcome without standing infrastructure.
- **Service worker / PWA update flow** (`workbox-window` waiting-worker prompt) —
  there is no service worker today. Revisit if/when the app adopts the PWA path noted
  under "Future Mobile Path" in `docs/architecture-appstack.md`; until then it is
  infrastructure we'd be adding solely for this signal.
- **Short interval polling** — wastes requests while the tab is idle or
  backgrounded; focus/visibility triggers fire precisely when a check is useful.
- **Pinning document navigations via the `__vdpl` cookie** — would disable the
  built-in document-navigation reload that is our passive baseline.

## Operational notes

- A tab idle longer than the 12-hour Max Age loses its Skew Protection pin. Combined
  with the update banner and the built-in document-navigation reload, the practical
  impact is small; the residual edge case is a >12h tab making a framework navigation
  to an aged-out asset, which 404s and the framework recovers from with a hard
  reload.
- If a deployed version has a bug or security issue and you need to stop active
  clients from reaching it, use Vercel's per-deployment **Skew Protection Threshold**
  (or delete the deployment) — this forces aged sessions off it. See
  `docs/doc-vercel.md`.
- Keep Max Age at or below the project's deployment-retention window; a pin to a
  deployment that retention has deleted cannot be served.
