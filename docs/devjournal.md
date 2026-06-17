# Development Journal

Each entry: **Date** | **Author** | **Title**, followed by description text. Most recent first.

---

## 2026-06-17 | James | Avatar signing degrades instead of 500ing under Storage load

A directory browse prefetched every member card, and each prefetch render signed that member's avatar via a separate Supabase Storage call; the burst exhausted Storage's DB pool (429), which `resolveAvatarUrls` rethrew into a page 500. Signing is now best-effort — it logs `avatar sign failed` and falls back to initials — and member cards no longer prefetch. Shipped urgent (advanced `urgentReleasedAt`) so open tabs reload off the crashing build.

## 2026-06-16 | James | Update handling for active sessions

The home page auto-reloads a stale tab, everywhere else a persistent bottom banner offers a member-initiated reload. Deploys now fall into one of three tiers: patch (default, notif held until the running build is 6h old, then once per 8h), feature (held until build is 2h old, then once per 8h, dismissible — whenever a changelog is added), urgent (immediate, non-dismissible — gated by `urgentReleasedAt` marker in code).  Full rationale: docs/strategy-deployment.md.

## 2026-06-12 | James | Unified top bar

Page titles and breadcrumbs now share one band with the fixed home/menu icons, via a shared `PageHeader` (full-width row, `pt-3` mains).

## 2026-06-12 | James | Home link + Onboarding gets an explicit ending

A home icon sits top-left on every page, the whole header (home + menu) hides during `/welcome`, profile-save now opens the Settings tab itself, and the first Done on /myweb runs a farewell capstone lighting up the home icon and menu icon together.

## 2026-06-12 | Blake | Anthropic's skill-creator skill vendored at .claude/skills/skill-creator/

Vendored verbatim and pinned to an upstream commit so every teammate can build/test our Skills on clone — no more per-user manual copies. Refresh via `node scripts/update-skill-creator.mjs`; acceptance evals in `evals/skill-creator.evals.json`; see docs/doc-skill-creator.md and docs/plan-skill-creator-vendoring.md.

## 2026-06-11 | James | Buttondown cutover complete

`BUTTONDOWN_SYNC_WRITE=1` is live in prod, the Apps Script trigger is disabled, and the Google Form is retired — the app is the sole writer of program tags. (#261, docs/design-buttondown.md)

## 2026-06-11 | James | Directory hides members who haven't set up their profile

`listMembers` now requires a non-empty bio — the existing "has set up their profile" marker (the form requires it, CSV signups already have one) — so not-fully-onboarded signups stay out of the Member Directory until they finish the welcome/profile step.

## 2026-06-11 | James | API logs now flush before the Vercel function freezes

next-axiom's buffered push was racing the serverless freeze and losing log events. The API middleware now ends every request with `waitUntil(log.flush())`.

## 2026-06-11 | James | CSV member importer retired

The final 3 Google Form signups were imported to prod; the importer (`scripts/import-members-csv.ts` and `scripts/normalize-referrals.ts`) is gone. Implementations live in git history.

## 2026-06-11 | James | Admin sign-in report; copyable member email list

/admin/signins shows each member's last sign-in and live-session activity; /admin/members now ends with a list of active member emails for pasting into Google Calendar.

## 2026-06-10 | James | Sentry now prod-only; replay only when ?debug-replay=1; tunnel renamed to /error-handling

Sentry is `enabled` only when `VERCEL_ENV=production`. Session replay records only when a session carries `?debug-replay=1` (see docs/doc-sentry.md). Tunnel route moved from `/monitoring` to `/error-handling` to read more honestly in devtools.

## 2026-06-09 | James | /me replaces /profile; stable, member-owned slugs (#376, #188)

`/profile` and `/profile/edit` merged into `/me` (Profile + Settings tabs); Settings holds the theme selector (docs/strategy-ui.md), profile URL, emergency contact, password, and deactivation. Slugs no longer track display-name changes: derived once, then edited only in Settings; display names may repeat, with name twins getting `-2`-style slug permutations.

## 2026-06-08 | James | Profile mini-map reuses the My Web renderer

The profile mini-map reuses My Web's renderer rather than a second one: `WebGraph` split into a presentational `WebGraphCanvas` (now with a read-only embed mode) plus focused layout/selection/simulation modules, and `relations.ts` into `relations-personal` and `relations-mini-map`. Edit the shared canvas with both surfaces in mind.

## 2026-06-08 | James | Local e2e reuses the running dev server (#372)

Playwright now targets the dev port and reuses a running `npm run dev` (via `reuseExistingServer`), so you no longer stop your dev server to run e2e; lanes set only `LANE_DEV_PORT` and the separate `E2E_PORT` is retired (stale lines in existing lane `.env.local`s are ignored). Tradeoff: an e2e run resets and drives the seeded `@testfake.local` users in your dev DB. Reference: docs/strategy-worktree-lanes.md.

## 2026-06-08 | James | One-click dev sign-in as Aria Chen

One-click sign-in as Aria Chen, now promoted to demo user in the dev-seed data.

## 2026-06-07 | James | Supabase config change: Irrelevant "Confirm email" setting is off (#366)

Production Supabase **Confirm email** toggle is now off so new invitees get the branded `magic_link` — the path returning members already use. Re-enable only if a `signUp({ email, password })` path is ever added.

## 2026-06-07 | James | Visible blocker for outdated browsers (#365)

A layout-level ES5 check (`public/legacy-check.js`) feature-detects old browser engines and reveals a plain-HTML `LegacyBrowserNotice`.

## 2026-06-07 | Benji | Homepage card categories

Grouped the logged-in homepage cards into three labeled sections — Community (Programs, Member directory, Current intentions), Personal (My web, My profile), and System (Invite a friend, Give Feedback) — with small uppercase category headers. Keeps the 2-column responsive grid within each section.

## 2026-06-06 | James | Logging convention: log.<level> over console.log (#262)

Codified in `docs/doc-axiom.md`: structured `log.<level>` (message = feature label) for app telemetry that should reach Axiom; `console.log` only for explicit dev/test helpers. Enforced by Biome `suspicious/noConsole`, with `off` overrides for `src/lib/timing.ts` and `tests/`/`scripts/`. Server Components must `await log.flush()`.

## 2026-06-06 | James | E2E warms routes in setup; nav budget back to 12s

The e2e setup project now warms the page-serving path (public routes + one sign-in) before timed tests, so the first spec no longer cold-starts inside `signInAs`'s budget; `TIMEOUT_MS` dropped 20s → 12s — warm a slow new route in `reset.setup.ts` rather than re-inflating the budget.

## 2026-06-06 | James | PUT /me syncs displayName to auth metadata (#229)

`PUT /me` now mirrors a displayName edit back into `auth.users.user_metadata` (best-effort) so auth-email greetings stop showing the signup-time name; no backfill, existing members self-heal on their next edit.

## 2026-06-05 | James | Parallel worktree "lanes" for concurrent dev/test

Each git worktree can run its own isolated Supabase stack + dev/e2e ports, so several branches (or agents) run dev/test/e2e at once without clobbering one DB. To try it: `git worktree add ../is-app-worktrees/is-app-2` (the dir name sets the lane), then inside it `npm install && npm run setup && npm run make_lane_inside_worktree`; from then on `npm run dev` / `npm test` / `npm run test:e2e` use lane 2's stack on +200 ports. Reference: docs/strategy-worktree-lanes.md.

## 2026-06-05 | James | Relations: remove a mistaken relationship (#352)

A `0 — No Relationship` control above 1–4 in the relating dialog deletes the relations row, shown only when editing a relationship that already exists (graph edge click, member-profile **Edit**).

## 2026-06-04 | James | Activity instrumentation for launch

Added `userId` (pseudonymous Supabase UUID) to the `api request` log so Axiom can count distinct people, and an admin **Activity metrics** view (`src/server/activity-metrics.ts`) reading the signup and invite funnels, plus a signed-in-past-week/month count from `auth.users.last_sign_in_at`, from current DB state.

## 2026-06-03 | James | Guard drizzle generate against stray auth-schema DDL

An attempt to stop `drizzle-kit generate` re-emitting `CREATE/ALTER/DROP TABLE "auth"` for the `pgSchema("auth")` reference (`schemaFilter`/`tablesFilter` gate only `pull`; tables have no `.existing()` yet — drizzle-orm #1305): `auth.users` is now tracked in the `0013` snapshot baseline, with a functional guard rejecting auth-schema DDL as the backstop.

## 2026-05-30 | Ola | Deactivate account (member self-serve, #185)

Members can deactivate their own account from the edit-profile page (`POST /me/deactivate`). Deactivated profiles are filtered from the directory, member lookups, relation suggestions, and the web graph — same `IS NULL` guard pattern as `profiles.hidden`. Members can reactivate themselves at any time via the same page (`POST /me/reactivate`); no admin action needed. `deactivated_at` is exposed in `GET /me` so the UI can show state. Functional tests cover deactivate, reactivate, and the self-shape assertion. (#301)

## 2026-05-29 | Ola | Quarterly intentions field (#243)

Added `current_intention` (text) and `intention_updated_at` (timestamptz) to profiles. Data migration copies existing `live_desire` values across. Field is shown on member profile pages with a month/year timestamp and is editable from the profile form. Renamed from the original `liveDesire` after James's feedback that they were the same concept.

## 2026-05-29 | James | About page + member-facing changelog (#170)

New `/about` page, with a changelog, version (the date of the newest entry), and short team blurb. Entries live in `src/lib/changelog.ts` — plain-language member-facing copy, deliberately separate from this journal; seeded by curating member-visible features out of it.

## 2026-05-29 | James | Re-timestamp a migration if main gained one after you generated it

Drizzle applies a migration only when its journal `when` is newer than the highest already-applied one, so a migration authored before a later one lands on `main` is silently skipped — no DDL, no error — on any DB already past that point. After rebasing, if `main` has a newer migration than yours, bump your entry's `when` in `drizzle/meta/_journal.json` above it. (Functional test added to catch this.)

## 2026-05-29 | Blake | Biome enforcement + codebase baseline (#307)

One-time baseline format pass on ~50 files of accumulated drift, plus three Biome enforcement layers: `npm test` gate, lefthook pre-commit auto-fix, and `biome ci .` in CI. Considered a per-edit Claude Code hook but dropped it — npx overhead was ~1.1s per Edit/Write; `scripts/biome-precommit.mjs` logs telemetry to inform whether to revisit. New `.git-blame-ignore-revs` skips the baseline commit; `npm run setup` wires the local `git config`.

## 2026-05-29 | Benji | Fix duplicate keywords (#219)

De-duplicate keywords on save in `parseEditableProfile` (server-side) and in `KeywordChips` (client-side). Fixes the React duplicate-key warning and prevents visually identical chips from rendering. Added a functional test asserting dedup on PUT /me.

## 2026-05-28 | Benji | Give Feedback card on homepage

Added a 6th card to the logged-in homepage grid linking to the Google Form feedback survey. Opens in a new tab, styled to match the existing NavCard pattern.

## 2026-05-27 | Blake | Portable AI procedure framework (#133)

Three Claude Code Skills (`/commit`, `/pr`, `/ship`) added under `.claude/skills/`, encoding the team's check-in workflow per the merged v5 spec from PR #133 and dev plan from PR #283. See `docs/spec-portable-ai-procedures.md` for behavior and `.claude/skills/{commit,pr,ship}/SKILL.md` for the per-Skill bodies.

## 2026-05-26 | Blake | Stash-pop antipattern callout in committing strategy

Added a callout to `docs/strategy-committing.md` warning against `git stash && X; git stash pop` as a clean-slate verification idiom — instead, use `git stash list` to check the stack first, and only pop if you actually put something there. Surfaced from RCA #284 (Gap 4); resolves #287.

## 2026-05-25 | James | Buttondown sync

Mirrors program memberships into Buttondown subscriber tags via a daily cron plus inline hooks on join/leave/admin-remove, replacing the Apps Script pipeline. Per-program opt-in via `programs.buttondown_tag`; ships in dry-run, then `scripts/buttondown-bootstrap.ts` reconciles the existing audience and `BUTTONDOWN_SYNC_WRITE=1` flips writes on. Design: `docs/design-buttondown.md`. (#280)

## 2026-05-24 | Benji | Custom 404 page

Added a `not-found.tsx` at the app root so unmatched routes show a styled 404 page consistent with the app's aesthetic — serif italic subtitle, centered layout, and a "Go home" button.

## 2026-05-24 | Benji | Joined program card ring highlight

Program cards now show a ring highlight when the user has joined, replacing the default border with `ring-3 ring-ring/50` for a clearer visual distinction.

## 2026-05-24 | Benji | Give Feedback link in sidebar

Added a "Give Feedback" link to the hamburger menu that opens a Google Form in a new tab. Includes a functional test asserting the link's presence, URL, and target attributes.

## 2026-05-21 | James | Polish programs (#226)

Four bundled improvements: new members are auto-subscribed to the weekly web update on first sign-in; programs gain `archivedAt` (hidden from members) and `signupsOpen` (gates self-serve join, closed by default); `profile_programs` becomes soft-deleted via `leftAt` so the original `assignedAt` survives leave/rejoin as a stable first-joined date; per-program detail pages live at `/programs/[slug]`.

## 2026-05-20 | James | Hidden accounts

Admins can hide profiles from the `/admin` page; hidden profiles disappear from the directory, web, and suggestions for non-admins. #168.

## 2026-05-19 | James | Multi-step welcome flow

Onboarding is now a sequence — agreements, profile, programs, then the personal web — with each step's completion recorded so the flow is resumable. Design: `docs/design-welcome.md` (#166).

## 2026-05-18 | James | Program administration

Admins manage programs at `/admin/programs`, with a per-program drill-down for editing and adding/removing participants.

## 2026-05-18 | James | Schema additions go through prod:db:expand

Updated `strategy-committing`: additive schema changes need manual action `npm run prod:db:expand` and then ship the schema and code in a single PR.

## 2026-05-16 | James | Profile pictures

Members upload a photo on the welcome/edit-profile screen and crop it in a circular modal (react-easy-crop); the server re-encodes it with `sharp` to a 1024² WebP and stores it in a private Supabase Storage `avatars` bucket. Avatars are served as 24h signed URLs — batched and cached in `src/server/avatars.ts` — and rendered through `next/image`. The `avatar_url` column (TS property `avatarPath`) now holds a Storage object path. Full design: `docs/design-profile-pictures.md`.

## 2026-05-15 | James | Node 24 LTS upgrade

`.nvmrc`, the three CI workflows, and `@types/node` move to Node 24 — catching CI and local dev up to production, which Vercel already runs on 24. `engines.node` now pins the version in source so the two can't drift again.

## 2026-05-13 | Benji | Homepage card redesign

Replaced the stacked button list on the logged-in home page with a responsive 2-column card grid. Each card has a title and short description, uses the existing `card`/`border`/`accent` design tokens, and shows a teal border + accent background on hover. Added a personalized greeting ("Welcome, [name]") and a serif italic subheading for warmth. Logged-out page unchanged.

## 2026-05-11 | James | Transactional email: Resend wired into Supabase Auth SMTP

Supabase Auth sends through Resend SMTP from `devteam@mail.intentionalsociety.org`, which can also receive email via existing Zoho mailbox. Rate limits: 50/hour at Supabase Auth (we set it), 100/day at Resend (free tier cap).

## 2026-05-11 | James | Perf/simplification improvements on auth/user/profile checks

Proxy passes `auth.getUser` through headers - signed-in `/` did three serial `supabase.auth.getUser` round-trips previously. The proxy now validates once and forwards the User on `x-supabase-user`. loadMe is cached (per-request), GetProfileForSelf is no longer cached.

## 2026-05-10 | James | Relations PR 4 — invite form, admin hints, welcome tour

Closes the initial Relations plan. The invite flow now has a strength setting and suggestion chips backed by a new shadcn-Command-based `MemberTypeahead`. The admin page's Web section allows additional suggestions. A react-joyride tour fires on first `/myweb` visit.

## 2026-05-10 | James | Admin page scaffold + `/api/admin/*` sub-router

`/admin` is a hub for admin-only stuff; non-admins get `notFound()`. Admin endpoints live behind a `requireAdmin` middleware in a `/api/admin/*` sub-router that 404s for non-admins. Future real settings will likely come from an `app_settings` table read by `getAppSettings()`.

## 2026-05-09 | James | Relations PRs 2 & 3 of the Relations ship

`/myweb` is live: WebGraph (`@xyflow/react` + `d3-force`) over a Hono RPC backend, with a WebBuilder list of people (with four types of suggestions sorted to the front) and a dialog to set relationship strength.

## 2026-05-07 | James | Replace ESLint with Biome

Why? `npm run lint` performance goes from 49 s → 0.9 s. Also we now have an automatic formatter tool (see biome.json).

## 2026-05-07 | Ola | Readable slug-based profile URLs

Profiles now have readable slug URLs (e.g. `/members/aria-chen` instead of `/members/00000000-...`). Added a nullable unique `slug` column to the profiles schema. Slugs are auto-generated from display name on profile create and update — "Aria Chen" becomes `aria-chen`. `getProfileForMember` accepts either slug or UUID so old UUID links don't break. If two members share a display name the second keeps a UUID URL until they update their name to something distinct. Directory cards link by slug when available, UUID otherwise.

One thing to know: existing profiles in a local DB won't have slugs until you either run `npm run seed:dev` (updated to populate slugs) or trigger a profile save. A Postgres-side backfill on deploy handles production.

## 2026-05-06 | James | Relations schema: PR 1 of the four-PR Relations ship

New `relations` and `invite_hints` tables, plus nullable `profiles.last_updated_web` and `invites.creator_value`. Schema-only — no API or UI yet — so previews (which skip migrate) keep serving the existing surface unchanged. See `docs/design-relations.md` and `docs/plan-relations.md`.

## 2026-05-06 | James | Doc categories: introduced `design-*`, dropped `doc-` prefix from strategy docs

`design-*.md` is a doc category for feature-scoped designs — sibling to `plan-*`, `strategy-*`, and `architecture-*`.

## 2026-05-03 | James | Server Components now actually use the API

The architecture doc has said since initial auth-phase 1 that the Hono API is the contract boundary "for every request regardless of origin (browser, Server Component, future mobile client)." In practice every Server Component had been skipping the API entirely! New `src/lib/api-server.ts` exposes `serverApiClient` (Hono RPC dispatched through an in-process `app.fetch`) and a `cache()`-wrapped `loadMe()`. Pages now go through the API for both data and auth-gating. Explicit (vs inferred) end-to-end types come from `InferResponseType`, exposed as named shapes (`Me`, `MemberProfile`, `Program`) in `src/lib/api-types.ts`. Dropped a hand-rolled `Program` type and an `as` cast in favor of the inferred one. The auth-callback route still talks to the DB directly because it's the route that creates the session in the first place.

## 2026-05-02 | James | Rename /login → /signin and /logout → /signout

Hard rename of "log" to "sign" based vocabulary for app-wide terminology consistency, no redirects or compat shims since there are no users yet.

## 2026-05-01 | James | UI / colors / visuals pass

Theme palette set to a mint surface with a dusty teal brand (with a dev-only `/colors` page to visualize it), Button primitive revamped and regularized across the app, root font size rebalanced around 18px, and the nav menu + home page reworked.

## 2026-05-01 | Benji | Programs list and self-join management

New `/programs` page lists all programs with title, description, and member count. Signed-in users can join or leave programs with a single click. The join/leave state is tracked via the existing `profile_programs` table with its `assigned_at` timestamp. Three new API endpoints: `GET /api/programs` (lists all programs with the current user's membership status), `POST /api/programs/:id/join`, and `POST /api/programs/:id/leave`. Home page now links to Programs alongside My profile and Manage invites.

## 2026-04-30 | Benji | Read-only profile view, edit moved to /profile/edit

`/profile` is now a read-only view of the user's profile info, with serif font (Ovo) for user-entered content and sans-serif labels. The edit form moved to `/profile/edit`, accessible via an "Edit profile" button. After saving, the form redirects back to `/profile`. Home page link updated from "Edit profile" to "My profile". Also bumped all `gray-200` hover/text classes to `gray-500` across the app for better contrast.

## 2026-04-29 | James | Next.js 16 upgrade

Bumped to Next 16; production builds now use Turbopack by default.

## 2026-04-26 | James | Security headers locked down

App now ships CSP, HSTS, frame/referrer/permissions headers from `next.config.ts`. See `docs/strategy-security.md` for per-directive rationale.

## 2026-04-26 | Benji | Move invite management to its own page

Extracted the `InvitesPanel` from the logged-in home page into a new `/invites` route (auth-gated, redirects to `/login` if unauthenticated). Home page now shows a "Manage invites" link instead of the inline panel. Updated e2e tests to navigate to `/invites` instead of expecting the panel on `/`.

## 2026-04-26 | James | shadcn widget library, client tests

Added shadcn/ui (4.5.0, Base Nova style, neutral palette, lucide icons), starting from a clean `shadcn init` so subsequent component additions diff cleanly. Typography matches www: Gudea sans for UI/headings, Ovo serif for prose. First real surface is a site header with a Sheet-based hamburger menu (Home, Welcome) that only renders for signed-in users — a client component reading `useAuth()` from a new `AuthProvider`. The provider seeds from a single server-side `getUser()` in the layout and stays live via `onAuthStateChange`, so sign-in/out and cross-tab updates propagate without per-navigation round-trips.

To make React component tests first-class, split Vitest into two projects — `functional-server` (Node, existing API tests, needs DB) and `functional-client` (jsdom + `@vitejs/plugin-react`, no DB, ~5s) — and enhanced `npm test` to include lint → typecheck → functional (both) → e2e. New client tests cover `AuthProvider` and `SiteHeader`, and TDD'd a fix where the tests can assert no `console.error` happens.

## 2026-04-25 | Blake | `check-env.mjs --fix` appends missing keys

Follow-up to the env-preflight work: `node scripts/check-env.mjs --fix` now appends any missing keys (with their `.env.local.example` values) directly to `.env.local`, with a dated provenance comment, so devs don't have to copy lines by hand. Existing values stay untouched; idempotent on re-run. Both the preflight error message and the `setup.mjs` hint now recommend `--fix` directly.

## 2026-04-23 | Blake | GitHub CLI documented as optional prerequisite

Added `## GitHub CLI` to `docs/setup-dev-machine.md` and a pointer in `docs/doc-local-setup.md`. Not required to run the app, but required for PR / issue workflows from the terminal — including via Claude Code, which can't drive a browser. Install via `winget` on Windows or `brew` on Mac, then `gh auth login` once per OS user. Credentials live in the OS keyring, so one login covers every same-user shell including the VS Code / Claude Code integrated terminal; WSL has its own state and needs a separate login.

## 2026-04-23 | Blake | `.env.local.example` as single source of truth + preflight drift check

The local-dev env template used to live as a string literal inside `scripts/setup.mjs`, and `ensureLocalEnv` was "create `.env.local` if missing, otherwise leave it alone." That's fine until the template grows — `.env.local` is gitignored, so existing devs silently keep stale files. We hit this when adding the e2e auth vars (`SUPABASE_SECRET_KEY`, `E2E_*_PASSWORD`, `CI_RESET_TOKEN`): old `.env.local` files kept working for `npm run dev` but blew up ten layers deep in Playwright setup with errors like "CI_RESET_TOKEN is required to run the e2e suite."

The fix is the standard `.env.local.example` pattern with a twist. `.env.local.example` is now committed as the canonical key list (values are the deterministic Supabase-CLI defaults plus non-sensitive local passwords, same as before). `scripts/setup.mjs` simplified to a `copyFileSync`. New `scripts/check-env.mjs` runs as the first step of `npm run dev:db` and diffs keys — if `.env.local` is missing anything declared in `.env.local.example`, it fails with the exact missing keys and the fix. Because every dev/test entry point (`npm run dev`, `npm run test:functional`, `npm run test:e2e`, `npm test`) chains through `dev:db`, the check runs everywhere for free.

Workflow when adding a new env var going forward: add the key + local default to `.env.local.example`, and every existing dev gets a clear, actionable error on their next `npm run dev` instead of a mystery test failure. Values in `.env.local` are never touched — devs are free to override locally.

## 2026-04-23 | Benji | Logged-out home page (#66)

`/` no longer redirects unauthenticated visitors to `/login`. Instead it renders a landing page with a "Sign in" button, a "Join with an invite code" link to `/signup`, and a friendly nudge for non-members to join a Connection Call (links to the www site's get-involved page). `/login` and `/signup` now cross-link to each other so visitors can always find the right path. Updated the auth and logout e2e tests to match the new behavior.

## 2026-04-22 | James | Skip Vercel preview for docs-only changes

Vercel's `ignoreCommand` now diffs HEAD against the previous successful deploy and skips the build when only `docs/` or root `CLAUDE.md` changed. See `docs/strategy-committing.md`.

## 2026-04-21 | Ola | Seed script for local development

Added `npm run seed:dev` to populate a fresh local database with believable test data — 15 member profiles, 3 programs (The Gumball Machine, Presence Pods, Thematic Crews), memberships spread realistically across them, and 5 redeemed invites that trace a real invite chain. All IDs are fixed so E2E tests can reference known values. Running it twice does nothing harmful.

One thing worth knowing: creating auth users in the seed script turned out to be trickier than expected. The `profiles` table has a foreign key to Supabase's `auth.users`, so you can't just insert profiles directly. The obvious approach — using the Supabase Admin API with the service-role key — broke when we found the new Supabase CLI (v2.89+) moved away from JWT keys to a new `sb_secret_*` format that the JS client couldn't parse. Ended up inserting directly into `auth.users` via the postgres superuser connection instead, which is simpler and doesn't care about key formats.

## 2026-04-20 | James | Auth Phase 3 (invites) complete

Member-generated invites are live. Any signed-in member mints a 10-char code (31-char alphabet — A–Z minus I/O, 2–9 minus 0/1) from `/`, with a 10-active-per-member cap, a 30-day expiry, and a required note that travels with the invite. `/signup` is the new front door: enter code → public `GET /api/invites/:code/check` surfaces the inviter's note (so the visitor recognises what the code is for) → enter email + display name → magic link goes through `/auth/callback?invite=<code>`.

Redemption is atomic inside `/auth/callback`: a single transaction inserts the profile row, runs the guarded `UPDATE invites SET redeemed_by = …` (active predicates plus Postgres row locking serialise concurrent redeemers), then stamps `referredBy`. If the UPDATE returns 0 rows the whole transaction rolls back, the session is signed out, and the visitor lands on `/login?error=invite_invalid`. The profile-first ordering is forced by the `invites.redeemed_by → profiles.id` FK — only a single transaction can satisfy both constraints cleanly.

Playwright can finally drive signed-in flows. The Phase 3a session helper provisions a test user via the Supabase Admin API, signs in through the real login form, and tears the user down (profile row first, since the FK has no cascade). The Phase 2 welcome e2e is backfilled in the same PR.

## 2026-04-19 | James | Auth Phase 2 (profile expansion) complete

`profiles` grew from three columns to the full community shape (bio, keywords, location, supplementaryInfo, referred-by, avatar, emergency contact, live desire, isAdmin) via additive `ALTER TABLE`s. `programs` and `profilePrograms` landed as empty structural tables — deliberately **not** joined into any profile shape; program membership will get its own endpoint.

Introduced serialization-layer access control: `getProfileForSelf` returns the full self view; `getProfileForMember` / `getProfileForAdmin` are `NotImplemented` stubs so the next person adding a directory or admin surface is forced to decide the visible shape rather than silently reusing self. `PUT /api/me` accepts only the editable subset and rejects unknown or privileged keys (`isAdmin`, `referredBy`, etc.) via a compact allowlist parser — no new validation dep.

`/welcome` is the first-sign-in completion flow: `/` redirects there when `bio IS NULL`, and the form saves via `PUT /api/me` plus an optional client-side `supabase.auth.updateUser({ password })`. Login grew an optional password field; blank still sends a magic link, which is also the recovery path (no "forgot password" link). Signed-in e2e coverage is deferred to Phase 3, which owns the Playwright session-minting helper.

## 2026-04-18 | James | Auth Phase 1 (plumbing) complete

End-to-end magic-link auth is wired. `/` is now a protected server component (unauthed → `/login`), the Hono API gates every route except `/api/health`, and `/api/me` returns a strict `{ id, email, profile }` shape that the functional test locks down so Phase 2's sensitive-field additions can't silently leak.

## 2026-04-14 | James | Drizzle migrations run in Vercel production build

Every production deploy now runs `drizzle-kit migrate` before `next build` (gated on `VERCEL_ENV=production` in `vercel.json`), and a failed migration aborts the deploy with the previous build still serving traffic. Preview deploys skip the migration and continue to hit the prod DB unchanged. See `docs/strategy-committing.md` for the expand-contract verification recipe that builds on this guarantee.

## 2026-04-07 | James | Observability: Sentry + Axiom

Sentry for error tracking, performance traces, and session replay. Axiom for structured request logs via Vercel Log Drain + next-axiom. Hono middleware logs method, path, status, and duration on every API request.

## 2026-04-06 | James | Local dev environment via Supabase CLI + Docker

`npm run dev` now auto-starts a local Supabase stack (Postgres, Auth, Studio) in Docker and runs Drizzle migrations. Each developer gets an isolated database. Drizzle is the sole migration tool — we don't use `supabase/migrations/`. Production still uses the hosted Supabase instance via env vars.

## 2026-04-05 | James | Testing and CI setup

Vitest for functional tests, Playwright for e2e browser tests. GitHub Actions CI runs lint + functional tests on every PR, then runs Playwright against the Vercel preview URL. Hono RPC client (`apiClient`) wired up for type-safe API calls from the frontend.

## 2026-04-04 | James | First end-to-end deployment live

App deployed to Vercel at `app.intentionalsociety.org`. Stack verified working: Next.js serving pages, Hono API responding at `/api/*`, Drizzle querying Supabase Postgres via transaction pooler. Supabase SSR client helpers set up for future auth flows (server/client/middleware pattern using `@supabase/ssr`).

## 2026-04-04 | James | Supabase Postgres requires transaction pooler for IPv4 + serverless

Supabase direct database connections resolve to IPv6 only (AWS stopped offering free IPv4 addresses). Local development and Vercel serverless functions may not route IPv6 properly. The fix is to use Supabase's **Transaction Pooler** connection string (`aws-*.pooler.supabase.com:6543`) which provides IPv4 and is also the correct choice for serverless environments where connections don't persist between invocations.

`DATABASE_URL` should always point to the transaction pooler, not the direct connection.

## 2026-04-04 | James | Enable Next.js typedRoutes for compile-time route safety

After dropping TanStack Router in favor of Next.js's built-in App Router, we lose compile-time type-safe route params and search params. The mitigation is two-fold:

1. **`typedRoutes: true`** in `next.config.js` — Next.js generates route type definitions in `.next/types` so that `<Link href="...">`, `push()`, `replace()`, and `prefetch()` all get compile-time checking of route paths. A typo in a route string becomes a TypeScript error. Zero dependencies, one line of config.

2. **Zod validation** for dynamic route params and search params inside page components. This is runtime, not compile-time, but it catches malformed URLs from external sources that no static check can cover.

Together these cover ~90% of what TanStack Router's type safety provided without adding a routing library alongside Next.js's own.
