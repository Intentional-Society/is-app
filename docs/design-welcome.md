# Onboarding / Welcome Flow — Design

**Tracking:** [#166](https://github.com/Intentional-Society/is-app/issues/166)

**Context:** Every member passes through a guided
onboarding sequence the first time they reach the app. Today that sequence is a
single profile form at `/welcome`. This document describes the expanded
multi-step flow.

---

## The sequence

Onboarding is four ordered steps:

1. **Agreements** — a welcome message and the community agreements, with an
   "I agree" button.
2. **Profile** — fill in or review profile data (and optionally set a password).
3. **Programs** — browse the available programs and join the ones of interest.
4. **Personal web** — build the relational web on `/myweb`.

Steps 1–3 live under `/welcome`. Step 4 is the existing `/myweb` page; the
welcome flow hands off to it at the end. The `/myweb` joyride tour remains
gated by its own marker (see below).

- The first "Done" click on `/myweb` runs a farewell capstone — a one-step
  tour spotlighting the top bar, lighting the home icon and the menu
  together (joyride takes one target per step, so `SiteHeader` carries an
  invisible full-width strip as the spotlight target) — giving onboarding
  an explicit end. During the `/welcome` steps `SiteHeader` renders
  nothing at all — no home link, no menu — so the guided sequence stays
  exit-free.

## Route structure

Each `/welcome` step is its own route segment under a shared layout:

```
/welcome/layout.tsx          shared shell + step / progress indicator
/welcome/page.tsx            index — redirects to the correct step
/welcome/agreements/page.tsx welcome message + agreements + "I agree"
/welcome/profile/page.tsx    AvatarUploader + profile form (today's content)
/welcome/programs/page.tsx   <ProgramsList /> + "Done"
```

Route segments — rather than swapping components inside one page with client
state — were chosen so the browser back button works, a refresh doesn't lose
progress, and the steps are individually reachable (useful for e2e tests).

Steps reuse existing components: `AvatarUploader`, `WelcomeForm` /
`ProfileFields`, and `ProgramsList` (the same component that backs the
standalone `/programs` page).

## Progress markers

Progress is tracked by four nullable timestamp columns on `profiles`, following
a consistent `last_<verb>_<noun>` naming pattern:

| Column                  | Set when                                   | Status   |
| ----------------------- | ------------------------------------------ | -------- |
| `last_signed_agreements`| user clicks "I agree"                      | **new**  |
| `last_updated_profile`  | profile form saves (`PUT /me`)             | existing |
| `last_reviewed_programs`| user clicks "Done" on the programs step    | **new**  |
| `last_updated_web`      | user clicks "Done" on `/myweb`             | existing |

The two new columns are an additive (expand-only) migration — new nullable
columns, no contract phase needed.

## Marker-driven routing

A single server-side helper decides where an onboarding member belongs:

```
welcomeEntryStep(profile) → "agreements" | "profile" | "programs" | null
```

It returns the first step whose marker is unset, or `null` when all three are
set. Routing is built on it in two places:

- **Home (`/`)** — if `welcomeEntryStep` is non-null, redirect into `/welcome`.
  This replaces today's single `!lastUpdatedProfile` check.
- **`/welcome` index** — recomputes `welcomeEntryStep` and redirects to
  `/welcome/<step>`, or to `/myweb` when onboarding is complete.

Each step, on completion, stamps its marker and then navigates to the
`/welcome` index — never to a hardcoded "next" segment. The index recomputes
and forwards. This keeps the step order in one place and means a member who
needs only one step (e.g. a future agreements re-prompt) is not walked through
steps they have already finished.

## Agreements content and versioning

The agreements text is **static, in-repo** content (JSX) — changing it is a
deploy. Alongside it lives a hardcoded constant marking when the text last
changed:

```ts
export const AGREEMENTS_UPDATED_AT = new Date("2026-05-19T00:00:00Z");
```

**Version-gating is not implemented yet.** For now the agreements step gates
only on `last_signed_agreements` being null — a member signs once and is never
re-prompted. The constant is defined now so the future change is small: making
the agreements gate `!lastSignedAgreements || lastSignedAgreements <
AGREEMENTS_UPDATED_AT` would re-prompt every member after the text is revised.
See [Future work](#future-work).

## API surface

The profile step keeps using the existing `PUT /me`, which already stamps
`last_updated_profile`. Two new endpoints mirror the existing
`PUT /me/last-updated-web`:

- `PUT /me/last-signed-agreements` — stamps `last_signed_agreements = now()`.
- `PUT /me/last-reviewed-programs` — stamps `last_reviewed_programs = now()`.

Joining and leaving programs uses the existing `POST /programs/:id/join` and
`/leave` endpoints unchanged.

## Rollout

Both new columns are nullable, so every **existing** member starts with
`last_signed_agreements` and `last_reviewed_programs` unset and is routed
through the agreements and programs steps once on their next visit (their
profile marker is already set, so the profile step is skipped). This is
intentional and acceptable — the current membership is the dev team.

## Future work

- **Agreements version-gating** — switch the agreements gate to compare against
  `AGREEMENTS_UPDATED_AT` so a revised agreement re-prompts the whole
  membership. Deferred deliberately.
