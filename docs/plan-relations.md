# Plan — Relations implementation

Status: planning, not started. Captured 2026-05-06. Archive once the feature ships.

Companion to `design-relations.md` — this doc holds the step-by-step plan for shipping the design. Long-lived rationale, schema, and decisions live in the design doc; temporary implementation details live here.

## Goal

Ship the relations feature as described in `design-relations.md`, in four merge-style PRs against `main` from the `relationship-web` branch.

## Decisions made before coding

- **Graph library: `react-flow`.** Native React integration, click-on-edge / click-on-node support, clean interop with TanStack Query optimistic updates.
- **Layout: `d3-force`, run as a live simulation.** Keeping the simulation alive (rather than one-shot-tick-and-freeze) means data changes animate naturally — alpha nudges up on add/update, the graph re-settles, and node-position animation is a byproduct of the layout instead of a separate animation system. Both libraries are MIT/BSD; the `d3-force` integration recipe on react-flow's site is gated as a Pro example, but the integration itself is ~50–100 lines and uses only the open-source pieces.
- **Hint UX in invite form: typeahead-member-search.** Start typing a member's name, pick from autocomplete, accumulate chips; each chip becomes one `invite_hints` row on submission.
- **Rating dialog control: button column.** Buttons labeled 1–4 next to descriptions. Numeric keystrokes 1–4 as backup. Outside-click cancels (no Save button, no Esc handling beyond outside-click).
- **URL: `/myweb`.** First-person, consistent with the mesh philosophy (every member at center of their own graph).
- **Component split: `WebGraph` (display) and `WebBuilder` (edit affordances).** Both compose on `/myweb`. `WebGraph` is parameterized on which member is at center and whether editing is enabled, so it can later be embedded read-only on member profile pages without rework. `WebBuilder` owns the candidate feed, rating dialog, and Edit/Done toggle.

## PR breakdown

The four PRs are sequential — later PRs depend on earlier ones. Each is a merge commit per the project's branching style.

### PR 1 — Schema migration

Scope:

- Add `relations` table with check constraints (no-self, value-range, hint-state).
- Add `invite_hints` table.
- Add `last_updated_web` column to `profiles`.
- Add `creator_value` column to `invites` with check constraint.
- Generate migration via `drizzle-kit generate`; verify locally via `npm run dev:db:reset`.

Tests (Vitest functional):

- `relations_value_range` rejects values outside 1..4 and accepts NULL.
- `relations_hint_state` accepts confirmed (value set, `isHint` false) and pending hint (value NULL, `isHint` true), rejects mixed states.
- `relations_no_self` rejects rater == ratee.
- `invites_creator_value_range` rejects values outside 1..4 and accepts NULL.
- Composite PKs reject duplicate (rater, ratee) and (invite, ratee) inserts.

Out of scope: any code that reads or writes the new tables. Migration only.

### PR 2 — Hono API surface

Scope:

- New routes (URL shapes are starting points — confirm during PR work):
  - `GET /api/relations/candidates` — feed for current user, ordered per design (people who rated me → hints → inviter's high-rated → recently active), excluding self and already-rated.
  - `GET /api/relations/subgraph` — current user's personal subgraph; query params for in/out/hop toggles.
  - `PUT /api/relations/:rateeId` — create or update a confirmed rating from the current user; converts a pending hint to confirmed if one exists.
  - `POST /api/relations/hint` — create a hint (admin-only at MVP — see Open questions).
  - `DELETE /api/relations/hint` — withdraw a hint (admin-only).
- Update `POST /api/invites` to accept `creatorValue` and `hints[]` (member ids).
- Materialization logic in invite redemption handler:
  - Insert a `relations` row from `creator_value` if set.
  - Insert `relations` rows for each `invite_hints` entry.
  - All in the same transaction as setting `redeemedBy` / `redeemedAt`.
- Soft-hide enforced server-side: candidate response strips the rater's value for "rated me" cards when the current user hasn't reciprocated. Client never sees the value, so no leakage.

Tests (Vitest functional):

- Candidate query returns expected ordering with seed data; excludes self and already-rated.
- Soft-hide: candidate response surfaces attribution but not the rater's value pre-response.
- Invite redemption is atomic — partial failures roll back materialization.
- Re-rating updates `value` and bumps `updatedAt` without changing the primary key.
- Hint → confirmed transition: setting `value` flips `isHint` to false and preserves `hintedBy`.

Out of scope: any UI consuming these endpoints.

### PR 3 — Relations page UI

The substantial PR. Scope:

- New route at `/myweb`, composing two new components:
  - `WebGraph` — the visualization. Props for `centerMemberId` and `interactive`. `react-flow` + live `d3-force` simulation, paired counter-edges for asymmetry, click-on-edge → re-rate dialog (when interactive), click-on-node → `/members/[id]`.
  - `WebBuilder` — the edit affordances. Owns the candidate feed (Suggestions auto-hides empty + Other members), the rating dialog (button column 1–4 + numeric keystrokes + outside-click cancel), and the Edit / Done toggle. Done bumps `last_updated_web` via API.
- Layout on `/myweb`: graph above, builder below (single column on mobile, grid on desktop).
- TanStack Query: feed and subgraph as queries; rating as mutation with optimistic update.
- Small-N rendering: graceful at N = 1, 2, 3 nodes — write explicit cases.

Tests:

- Vitest for non-trivial client logic (cache update on rate, optimistic graph state).
- Playwright e2e: rate first candidate → graph populates → toggle Edit/Done → reopen and re-rate.

Out of scope: invite form updates, welcome tour overlays.

### PR 4 — Invite form + welcome tour

Scope:

- Update the invite-creation form (`/invites` or wherever it lives now) with:
  - `creator_value` picker (1–4) right after the "who is this" input.
  - Soft warn at value 1 ("inviting someone you've only met in group settings tends to lead to weak fit — is this the right time?" — copy TBD).
  - Typeahead-member-search widget for hints — name autocomplete → chip accumulator. Each chip becomes one `invite_hints` row on submit.
- Welcome tour using `react-joyride`:
  - Steps: welcome → profile (existing form at `/welcome`) → relations → see your web.
  - Tour fires when `lastUpdatedWeb IS NULL` on the user's profile (covers both new members and existing members on their first post-deploy login).
  - Tour completion is implicit — clicking Done on the relations page sets `last_updated_web` and ends it.

Tests:

- Vitest functional: `creator_value` validation in invite-create handler.
- Playwright e2e: full signup-tour-flow happy path, including hints arriving as candidates and `creator_value` arriving as a "rated me" signal.

Out of scope: vocabulary refinement, view-relation detail surface, hint withdrawal UX.

## Sequencing notes

- Each PR lands on `main` in order, with merge commits (not squash) per project style.
- Run full `npm test` (functional + e2e) before opening each PR.
- The `relationship-web` branch base shifts forward as each PR merges — rebase, don't merge, when main moves.
- PR 3 is the longest piece; expect to spend more time there than the other three combined.

## Migration notes

- `relations` and `invite_hints` are new tables — no expand-contract phasing needed.
- `profiles.last_updated_web` and `invites.creator_value` are nullable columns — additive expansion only, safe to ship.
- The migration runs in CI on production deploys via `drizzle-kit migrate` (already wired per `CLAUDE.md`).

## Test coverage expectations

| Layer | Tool | Cases |
| --- | --- | --- |
| DB constraints | Vitest | All check constraints, accept and reject paths. |
| API | Vitest | Candidate ordering, soft-hide, redemption atomicity, hint transitions, re-rating semantics. |
| Client logic | Vitest | Optimistic cache mutation on rate; graph state on edge / node click. |
| End-to-end | Playwright | Signup-with-hints flow; build/view mode toggle; re-rating an existing relation. |

## Open questions during implementation

- **Hint creation by non-admin members.** MVP recommendation: admin-only (`profiles.is_admin = true`). Decide in PR 2 whether a member-facing hint endpoint exists at all, or if all hints flow through admin tooling.
- **Tour resume vs restart.** A user who quits mid-tour returns to it on next login (because `lastUpdatedWeb IS NULL`). Verify that `react-joyride` handles starting mid-step gracefully, or accept that they restart from step 1.

## Status

- Branch: `relationship-web` (created 2026-05-04 from `origin/main`).
- Design doc: `docs/design-relations.md` — settled.
- This plan: drafted 2026-05-06.
- PRs: not yet started.
