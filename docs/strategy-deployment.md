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

**Configuration.** Skew Protection is enabled on the project (default for supported
frameworks since 2024-11-19; it requires a Pro or Enterprise team). Its **Max Age**
controls how long a tab stays pinned. Past it, a framework-managed request to the
aged-out deployment returns a **404**, which Next.js recovers from by hard-reloading
onto the latest version — a graceless fallback that discards unsaved state, exactly
what the update banner exists to pre-empt.

So Max Age and the notify holds are independent clocks. Max Age is set
to **7 days** — far longer than any notify hold (a first nudge at 6 hours for a patch, 2
for a feature, then a reminder at most once every 8). The holds decide when we *gently
offer* an update; Max Age is how
long we *protect* a tab that hasn't taken one. With the pin that much longer than the
holds, the graceful path (banner, reloaded at a moment the member chooses) has nearly a
week of runway before the 404 fallback can fire. See `docs/doc-vercel.md` for the
dashboard setting.

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
3. The pin lapses once a tab outlives the Max Age, after which that long-idle tab is
   unprotected again.

We deliberately do **not** set the `__vdpl` cookie (the "extend Skew Protection for
long-lived sessions" pattern that pins document navigations too). Setting it would
disable the built-in document-navigation reload, which is the baseline we rely on.

## The new-version signal

To close gap #2 above, the app actively detects a newer production deployment and
surfaces a member-initiated reload. This is the "an update is available" banner.

Not every deploy deserves the same interruption. Updates fall into three tiers, and
the banner's insistence scales with them:

- **Patch** — bug fixes, refactors, infra. No member-facing changelog entry; nobody is
  waiting for it. Notified *gently and late* (see "What the member sees").
- **Feature** — new member-facing functionality. Earns a changelog entry. Notified
  after a brief hold, dismissibly.
- **Urgent** — a fix for active breakage or a security exposure that old clients must
  stop running. Notified immediately and non-dismissibly.

The tier is derived from artifacts we already produce, not flipped by hand per deploy
(see "Update tiers"). A given member's effective tier is the **highest** tier among
all deploys they are missing: one pending feature outranks any number of pending
patches, and one pending urgent outranks everything.

### Detection

The open tab carries three values frozen into its bundle at build time, and compares
each against the live production values from `GET /api/version`:

| Frozen in the running bundle | Live from `/api/version` | The comparison says |
| --- | --- | --- |
| `NEXT_PUBLIC_BUILD_ID` (deployment id) | `id` | differ → a newer deploy exists at all → at least **patch** |
| the bundle's own `appVersion` (`src/lib/changelog.tsx`) | `appVersion` | live is newer → a changelog entry shipped since → **feature** |
| `NEXT_PUBLIC_BUILD_TIME` (when this build shipped) | `urgentReleasedAt` | `BUILD_TIME < urgentReleasedAt` → an urgent deploy shipped *after* this build → **urgent** |

`NEXT_PUBLIC_BUILD_TIME` pulls double duty: it is both the urgent comparison above and
the patch clock (see "What the member sees"). `next.config.ts` inlines it alongside
`NEXT_PUBLIC_BUILD_ID` (from `VERCEL_DEPLOYMENT_ID`, falling back to `"dev"` locally).
`appVersion` is in the client bundle as a plain export of `src/lib/changelog.tsx`, so
the tab compares its built-in copy against the live one; `urgentReleasedAt` is also a
`changelog.tsx` export but is read only server-side for `/api/version` — the tab needs
no frozen copy of it, because it compares the live value against its own build time.
`GET /api/version` (unauthenticated, in the Hono API at `src/server/api.ts`) returns
the *current* deployment's view, read per request:

```ts
{ id: process.env.VERCEL_DEPLOYMENT_ID ?? "dev", appVersion, urgentReleasedAt }
```

The detection works *because of* a Skew Protection detail: the framework pins
framework-managed requests, but **not custom `fetch()` calls**. The poll to
`/api/version` is a plain client `fetch`, so it is not pinned — it resolves to the
*current production* deployment and returns that deployment's values, not the
session's. (Do not add `?dpl=` or an `x-deployment-id` header to this fetch, or it
would pin and always report the session's own state.)

Because `appVersion` and `urgentReleasedAt` are themselves baked into every deployment,
an old tab polling the *current* `/api/version` learns the current high-water marks and
can place itself without any per-session server state: `id` differing proves *something*
is newer; the live `appVersion` outrunning the tab's built-in copy, or `urgentReleasedAt`
post-dating the tab's own build time, proves *what kind*. The server stays stateless
serverless.

### Update tiers

The tier is not a per-deploy switch someone remembers to flip; it falls out of work we
already do:

- **Feature** is whatever bumps `appVersion`. `appVersion` is the date of the newest
  member-facing changelog entry (`src/lib/changelog.tsx`), so "did this deploy earn a
  changelog entry?" *is* the patch-vs-feature decision — the same call we already make
  when writing the entry. Nothing extra.
- **Patch** is the default: any deploy with no new changelog entry. No marker, no
  ceremony.
- **Urgent** is the one tier that needs a deliberate gesture, which is right for
  something this rare. We advance a committed `urgentReleasedAt` marker (an ISO 8601
  timestamp — a full datetime, not a plain date like `appVersion`, so two urgent
  deploys on the same day still strictly advance it — exported alongside `appVersion`
  in `src/lib/changelog.tsx`) in the same PR that ships the fix. Bumping it declares
  "old clients must not keep running," visible in the diff and reviewed like any code.

Deriving every tier from in-repo artifacts at build time keeps the classification in
the same commit as the change it describes, with nothing to set at deploy time.

### When we poll

`useNewVersionAvailable` checks on mount, on window `focus`, and on
`visibilitychange` → visible. There is no short interval timer. Focus is the moment
the member returns to the tab and is about to act on possibly-stale code — exactly
when a check is worth doing, and free while the tab is backgrounded. (This mirrors
the instinct behind TanStack Query's `refetchOnWindowFocus`, which the app already
relies on.)

### What the member sees

The same banner component renders all three tiers; the tier controls its message, *when*
it appears, and whether it can be dismissed. The Reload control sits inline in the
sentence and always calls `window.location.reload()` — a full document navigation, so it
pulls the latest production assets.

- **Patch:** a dismissible banner — *"A new version of the app is ready: please Reload
  when convenient."* — held back until the session is worth interrupting. It does **not**
  appear the moment a patch lands. It waits until the running build is at least **6
  hours old**, then shows at most **once per 8 hours** (a dismissal is remembered in
  `localStorage`). An actively-used fresh session is never interrupted for a bug fix, and
  several patches landing across a day collapse into a single eventual nudge.
- **Feature:** a dismissible banner that names the win — *"The app has new features for
  you: please Reload when convenient."* — shown once the running build is **2 hours
  old**. A brief hold, far shorter than patch's: the member-facing change is the whole
  reason to tell them, but a just-loaded session isn't interrupted even for that.
  Persistent, not a modal: they finish what they are doing and reload at a safe stopping
  point. Like patch, a dismissal is remembered in `localStorage`, so the banner returns
  at most **once per 8 hours** rather than vanishing for the rest of the session.
- **Urgent:** a non-dismissible banner — *"An urgent update to the app is ready: please
  Reload at the first opportunity."* — **immediately**. Still member-initiated (one
  click, never automatic), but it cannot be dismissed.

The patch clock is the running build's own age (`NEXT_PUBLIC_BUILD_TIME`), not the
moment a newer patch happened to land. Measuring from when the member's build *shipped*,
rather than from when it was first superseded, keeps the clock to one value we can
inline and reason about; the difference is at most the gap between a member's load and
the next patch, and erring toward *later* notification is exactly the goal. This 6-hour
window sits far inside the 7-day Skew Protection Max Age (see above), so the gentle
nudge reliably reaches a patch-only tab long before its pin could lapse into a hard
reload.

The banner is a client component mounted in the root layout: a persistent card pinned
to the bottom of the viewport (never a modal — it doesn't block the page), carrying the
message with the Reload button inline in it, plus a dismiss control on the non-urgent
tiers. It uses the
app's theme tokens (`bg-card`, `border`, `text-foreground`) so it reads as part of the
app; the urgent tier firms up the border to match its weight.

### Why never force-refresh

Auto-reloading the page the instant a new deploy is detected is rejected **on any
surface a member is working in**. A forced reload discards unsaved client state, and
this app is mostly input surfaces where that is real damage:

- Profile **Edit mode** — an unsaved bio / keywords
- The **My Web** canvas and relation dialog (`src/app/myweb/`)
- The **welcome / onboarding** flow mid-step
- The **feedback** form

Getting a member onto the latest build thirty seconds sooner is not worth deleting a
half-written profile. Even the urgent path stays member-initiated — we make the
prompt impossible to ignore (non-dismissible) rather than impossible to avoid
(automatic).

### The home page: an active safe-refresh point

The one place we *do* reload automatically is the home page (`/`). The rule above
guards unsaved input; home has none at the moment a member lands on it. It is reached
either by a fresh document load (already current) or by an in-app `<Link>` navigation
(pinned to the old bundle), and in both cases nothing has been typed yet — so a small
client component checks the live version on mount and, if the tab is stale, reloads
immediately, bypassing the tier holds. (`window.location.reload()`, not
`router.refresh()`: a soft refresh re-runs server components but stays pinned to the old
deployment, so it would never pull the new bundle.)

This turns home into an *active* version of the passive document-navigation reload — it
catches the SPA navigator (gap #2) the built-in reload misses. Because members pass
through home routinely, most self-heal to current there and never see the banner; the
banner becomes the safety net for members who stay deep in the input surfaces.

The safety rests on firing *before interaction*, not on home staying input-free. The
check is an async fetch, so a keystroke can land in the sub-second window after mount;
if one does, the reload is skipped and the banner takes over. A short `sessionStorage`
cooldown guards against a reload loop if the version endpoint ever flaps. Home can hold
inputs freely — only the reload's *timing* carries the guarantee.

## Relationship to the changelog

Two identities do two jobs, and the split is the point:

- `NEXT_PUBLIC_BUILD_ID` (deployment identity) decides **whether** there is anything
  newer at all. Most deploys — bug fixes, infra, the very fixes we sometimes most want
  out — do not touch the changelog, so the *trigger* has to key on deployment id or it
  would miss them entirely.
- `appVersion` in `src/lib/changelog.tsx` (the newest member-facing entry's date, shown
  on `/about`) decides **how loudly** to notify. A deploy that advanced it is a feature
  and earns an immediate banner; one that didn't is a patch and is held back.

So the changelog is no longer only an `/about` decoration: the same entry that tells a
member "here's what's new" is what promotes their next update from a quiet patch nudge
to an immediate one. Writing the entry and choosing the tier are one action.

## Rejected alternatives

- **Automatic force-refresh on a working surface** — discards unsaved work; see "Why
  never force-refresh." The home page is the deliberate exception — a safe-refresh point
  that reloads pre-interaction, see above.
- **Notifying equally on every deploy** — rejected as notification fatigue. Most
  deploys are patches nobody is waiting on; interrupting an active session for each one
  trains members to ignore the banner, blunting it for the feature and urgent deploys
  that matter. The patch tier's "6h-old, then once-per-8h" hold is the answer.
- **Per-deploy env-var tiering (a `CRITICAL_UPDATE` flag on the Vercel deployment)** —
  rejected: a manual dashboard step at the worst possible moment (shipping an urgent
  fix), and invisible in the diff. The tier is derived from the changelog and a
  committed `urgentReleasedAt` marker instead; see "Update tiers."
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

- Shipping each tier: a **patch** needs nothing. A **feature** needs its changelog entry
  (which it earns anyway) — that bump is what promotes it from a quiet patch nudge to a prompt feature notice. An **urgent**
  deploy advances `urgentReleasedAt` in `src/lib/changelog.tsx` in the same PR; that
  one-line committed change is the only manual tier signal, and it is not an env var.
- A tab that outlives the Max Age loses its pin: its next framework-managed request to
  the aged-out deployment 404s and Next.js hard-reloads it onto the latest version.
  Because Max Age (7 days) is far above the patch hold, the gentle banner
  almost always reaches a patch-only tab first, so this fallback stays an edge case.
- Max Age is **7 days**. It cannot exceed the project's deployment-retention window — a
  pin to a deployment retention has already deleted cannot be served — so keep
  retention at or above 7 days.
- If a deployed version has a bug or security issue and you need to stop active
  clients from reaching it, use Vercel's per-deployment **Skew Protection Threshold**
  (or delete the deployment) — this forces aged sessions off it. See
  `docs/doc-vercel.md`.
