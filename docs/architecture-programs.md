# Architecture — Programs platform (events, bids, program content, roles)

Status: draft 2026-07-09, in workshop — boosted from a James outline by Claude; events and calendaring broken out to `docs/design-events.md` in the first iteration. The [prioritized key questions](#key-questions-prioritized) at the end are the review agenda; the schema sketches are provisional until the P1 questions are answered. Author: James (outline) + Claude (draft).

This is an architecture doc — it spans several future features and sets the shared foundation they build on. Individual features get their own `design-*` docs as they come due (`design-events.md` exists; bids and gumball will follow); this document decides what they have in common.

## Purpose

Any number of IS programs will have custom functionality and content in the web app. Custom development per program is accepted and expected — the goal here is that the *persistent state* underneath those custom experiences lands in a small set of shared data models instead of a new table per program idea. Three shared primitives cover most of what the known programs need:

1. **Events** — singular and recurring gatherings, with a scheme for managing calendar invitations through the free Google Calendar account. Designed in `docs/design-events.md`.
2. **Program items** — program-scoped content (notes, announcements, submissions) in one generic table, so "a box people can put things in" never needs its own migration.
3. **Bids** — offers and asks (giving and receiving), the first coordination feature anticipated by `design-relations.md`'s deferred "coordination leg."

Underneath all three: **program roles**, so program leads — a role the app has lacked entirely — can run their programs without `isAdmin`.

Program-specific UI appears in the program detail page, and can also surface as a home-page card and/or dedicated pages.

## What exists today (the substrate)

The platform spine is already built and battle-tested:

- **`programs`** (`src/server/schema.ts:77`) — the registry. Programs are database rows, not code constants: slug, name, blurb, description, `archivedAt`, `signupsOpen`, `buttondownTag`. Admin CRUD at `/admin/programs`; member list/detail/join/leave at `/programs` and `/programs/[slug]`.
- **`profile_programs`** (`schema.ts:115`) — membership with history. Soft-delete via `leftAt`; `assignedAt` survives leave/rejoin cycles as the stable first-joined date. This is exactly the shape program history features need, and new membership-like tables below copy its idiom.
- **The Buttondown sync** (`docs/design-buttondown.md`) — a proven pattern for mirroring app state into an external delivery system: a one-sentence invariant, a managed universe the sync never writes outside of, diff-only writes, an inline best-effort fast path plus a daily reconciler cron, a lease-based `sync_locks` row, dry-run write gates, and prod-only-by-construction env locks. The calendar scheme in `design-events.md` reuses this pattern wholesale.
- **Real program rows** already distinguish cohorts: "Presence Pods (2026 Q2)" and "Casework Pods (2026 Q3)" are separate programs. A pod *round* is a program; pods are subgroups within it.

Events, calendars, bids, roles, and program-scoped content have no existing code — this is greenfield on top of the spine.

## Design principles

### 1. Shared primitives, custom edges

Custom per-program development happens in UI and logic; persistent state defaults into the shared tables (`events`, `bids`, `program_items`, `programs.config`). A program earns a custom table only via the graduation rule below.

### 2. The graduation rule

**Content flows through `program_items`; relationship-shaped data gets a real table.** A thing graduates to its own table when it needs FKs to other rows, uniqueness constraints, or relational queries beyond "scoped to this program, ordered by time" — pod assignments (FK to a pod, membership history queries) and gumball matches (pairs of profiles) qualify; message-box notes and announcement submissions do not. This keeps `program_items` from becoming a junk drawer while keeping the schema small.

### 3. External delivery is a mirror, not a second source of truth

The app owns who is in which program and what events exist; Google Calendar owns invitation delivery and attendee RSVP state, exactly as Buttondown owns email delivery. Every sync is stated as an invariant, scoped to a managed universe, and reconciled by a cron with an inline fast path.

### 4. Customization keys on `programs.kind`, in code

A nullable `kind` column on `programs` (e.g. `'community-calls'`, `'pods'`, `'gumball'`) is the hook connecting a database row to its custom code. A code-side registry maps kind → React components (detail-page section, home card) and server capabilities. Two properties make `kind` better than keying on slug: slugs stay a URL concern admins can edit freely, and several rows can share one kind — both pod-round programs are `kind = 'pods'`. `kind = NULL` is a plain program with the standard shell and no custom behavior, which is the common case.

Admin-tunable *values* (a Trello URL, message-box prompt copy, calendar-sync toggles) live in a `programs.config` jsonb column, zod-validated per kind. Capabilities and components live in code; knobs live in config.

### 5. Programs are run by leads, not only admins

Every management surface the platform adds (events, item moderation, pod assignment) checks `isAdmin || isLeadOf(programId)` rather than `isAdmin` alone. The role model is below.

## Data model

Sketches follow house schema conventions (uuid PKs, timestamptz, check constraints, `.enableRLS()`). Names and details are provisional.

### `programs` additions

```ts
// add to programs table
kind: text("kind"),      // registry key; NULL = plain program
config: jsonb("config"), // admin-tunable per-kind knobs, zod-validated in code
```

### Program roles

One column on the existing membership table — a role is an attribute of a current membership:

```ts
// add to profile_programs
role: text("role").notNull().default("participant"), // 'participant' | 'lead'
```

plus a check constraint on the two values. Semantics:

- **`lead`** is the per-program steward: manages the program's events (series and occurrences), moderates its `program_items`, runs kind-specific tooling (pod assignment, gumball matchmaking support). The proposed capability matrix is below (Q7 confirms it).
- **Admins assign roles** via the admin program detail page. Leads don't promote other leads at v1.
- **Leaving clears the role.** `leaveProgram` / `removeParticipant` reset `role` to `'participant'` alongside setting `leftAt`, so a self-serve rejoin can't silently restore lead powers.
- The permission predicate `isAdmin || isLeadOf(programId)` becomes the standard check in every program-management route the platform adds. Existing admin-only routes (program CRUD, participant add/remove) keep their current gates until Q7 says otherwise.

Proposed v1 capability matrix (provisional):

| Capability | Participant | Lead | Admin |
| --- | --- | --- | --- |
| Join/leave (when `signupsOpen`), post items, place bids, RSVP | ✓ | ✓ | ✓ |
| Create/edit/cancel the program's events | | ✓ | ✓ |
| Delete others' `program_items` in the program | | ✓ | ✓ |
| Edit program blurb/description | | ✓ | ✓ |
| Kind-specific tooling (pod assignment, match support) | | ✓ | ✓ |
| Program create/archive, slug/kind/config/`buttondownTag`, participant add/remove, email export | | | ✓ |

### Events

Designed in `docs/design-events.md`. In one paragraph, for the mapping table below: an `event_series` table holds recurrence rules (constrained RRULE + IANA timezone anchor); a generator cron materializes concrete `events` occurrence rows on a rolling horizon; singular events are occurrence rows with no series; an optional `event_rsvps` table is gated on the RSVP question. Calendar invitations flow through a Buttondown-shaped sync that mirrors app events onto the existing free Google Calendar account via OAuth, with add-to-calendar links as the always-available fallback affordance.

### Bids

One table for offers and asks. A bid is scoped to a program's participants or to the whole network.

```ts
export const bids = pgTable(
  "bids",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    profileId: uuid("profile_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
    // NULL = network-wide; set = visible to / aimed at that program's participants
    programId: uuid("program_id").references(() => programs.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),             // 'offer' | 'ask'
    title: text("title").notNull(),
    body: text("body"),                       // markdown
    status: text("status").notNull().default("open"), // 'open' | 'fulfilled' | 'withdrawn'
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    check("bids_kind", sql`${table.kind} IN ('offer', 'ask')`),
    check("bids_status", sql`${table.status} IN ('open', 'fulfilled', 'withdrawn')`),
  ],
).enableRLS();
```

Response mechanics are deliberately unmodeled here (Q1): the leanest v1 treats a bid as a broadcast and lets the response happen person-to-person; a `bid_interests` table (`bidId`, `profileId`, `note`) is the next rung if we want the app to capture "I'm in." This is the relations doc's deferred coordination leg — once the relational web has density, bid feeds can filter and rank by relational proximity.

### `program_items`

The generic program-scoped content table — the "reduce custom tables" workhorse.

```ts
export const programItems = pgTable("program_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  programId: uuid("program_id").notNull().references(() => programs.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),               // code-side registry: 'message' | 'announcement' | 'event-submission' | ...
  authorId: uuid("author_id").references(() => profiles.id, { onDelete: "set null" }),
  body: text("body"),                          // markdown
  data: jsonb("data").notNull().default(sql`'{}'::jsonb`), // per-kind structured fields, zod-validated
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
    .$onUpdate(() => new Date()),
  deletedAt: timestamp("deleted_at", { withTimezone: true }), // soft delete, house idiom
}).enableRLS();
// index: (program_id, kind, created_at DESC)
```

Each `kind` is registered in code with a zod schema for `data`, so the jsonb column is typed at the API boundary even though Postgres sees it as opaque. Known v1 kinds: `message` (Community Calls' Message Box — `body` only), `announcement` and `event-submission` (Weekly Web Updates intake — `data` carries link, date, etc.).

### Custom tables that pass the graduation rule

**Pods** — subgroups within a pod-round program, with membership history. Copies the `profile_programs` soft-delete idiom:

```ts
export const pods = pgTable("pods", {
  id: uuid("id").primaryKey().defaultRandom(),
  programId: uuid("program_id").notNull().references(() => programs.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  dissolvedAt: timestamp("dissolved_at", { withTimezone: true }),
});

export const podMembers = pgTable(
  "pod_members",
  {
    podId: uuid("pod_id").notNull().references(() => pods.id, { onDelete: "cascade" }),
    profileId: uuid("profile_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
    leftAt: timestamp("left_at", { withTimezone: true }),
  },
  (table) => [primaryKey({ columns: [table.podId, table.profileId] })],
);
```

"Who is in which pod" is current rows; history is the full table. Cohort/round identity comes from the program row itself (existing convention).

**Gumball matches** — pairs of profiles with a lifecycle; illustrative sketch, details belong to the gumball design doc (Q8):

```ts
export const gumballMatches = pgTable("gumball_matches", {
  id: uuid("id").primaryKey().defaultRandom(),
  programId: uuid("program_id").notNull().references(() => programs.id, { onDelete: "cascade" }),
  profileAId: uuid("profile_a_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
  profileBId: uuid("profile_b_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
  matchedAt: timestamp("matched_at", { withTimezone: true }).notNull().defaultNow(),
  status: text("status").notNull().default("proposed"), // lifecycle TBD in design doc
});
```

## Calendar invitations

Designed in `docs/design-events.md`. The shape: a Buttondown-pattern sync whose invariant is *"every calendar-synced app event exists on the IS Google Calendar with time, title, and location matching the app's record, and with its attendee list equal to the current participants of its program."* The write path is OAuth as the existing free GCal account (a service account cannot invite attendees without Workspace delegation); the sync owns only events it marked, pushes inline on change with a reconciler cron behind it, and gates writes behind a `GCAL_SYNC_WRITE` dry-run flag. The design doc carries the verified Google constraints (token lifetime, "known senders" filtering, abuse limits), the rejected alternatives, and the go/no-go OAuth spike that is its question 1.

## UI surfaces

Three surfaces, all keyed through the `kind` registry:

- **Program detail page** (`/programs/[slug]`) — the existing shell (description, roster, join/leave in `program-slug-detail.tsx`) grows a slot: after the standard content, render the registry's `DetailSection` component for the program's kind, if any. Shared-primitive UI (upcoming events list, open bids, message box) composes from reusable components inside those sections.
- **Home page card** — today's home (`src/app/page.tsx`) is hand-authored `NavCard` JSX in three sections; program cards join the Community section. The registry contributes richer `HomeCard` components (next call time, latest messages) fetched via `apiClient`/TanStack Query like everything else. At five programs, hand-placing cards is fine; the registry's job is the component contract, and placement policy is Q3.
- **Dedicated pages** — a program needing more room gets ordinary hand-authored routes (e.g. `/programs/community-calls/messages`, or a top-level route if it earns one). Custom development per program is accepted; the registry standardizes only the two shared slots above.

The registry itself is a code-side map, roughly:

```ts
// src/lib/program-features.tsx
export const programFeatures: Record<string, ProgramFeature> = {
  "community-calls": { DetailSection: CommunityCallsSection, HomeCard: CommunityCallsCard },
  "pods":            { DetailSection: PodsSection },
  "gumball":         { DetailSection: GumballSection },
  "service-team":    { DetailSection: LinksSection },       // renders config.links
  "weekly-web-updates": { DetailSection: SubmissionsSection },
};
```

## Program-by-program mapping

How the five named examples decompose onto the primitives — the test that the model is sufficient:

| Program | Shared primitives | Custom |
| --- | --- | --- |
| **Community Calls** | `event_series` (recurring Sundays) + GCal mirror (`design-events.md`); `program_items` kind `message` (Message Box); `bids` scoped to the program | Message Box UI; bids feed section |
| **Pods** | `programs` per round (existing convention); `profile_programs` for round membership; leads run assignment | `pods` + `pod_members` tables; assignment admin UI; history view |
| **Gumball machine** | `programs` + membership as the opt-in pool | `gumball_matches` table; matchmaking support UI (later: relations-graph-aware) |
| **Service team** | `programs.config.links.trello` — pure config, zero schema | `LinksSection` renderer; a future in-house Tasks system is its own design (Q9) |
| **Weekly Web Updates** | `program_items` kinds `announcement` + `event-submission` | submission forms; admin digest view feeding the Buttondown email (Q5) |

Everything lands on shared primitives except the two tables that pass the graduation rule — which is the outcome the rule exists to produce.

## Rollout sketch

Each phase is independently shippable; expand-step migrations land ahead of code per `strategy-committing.md`.

1. **Phase 0 — answer P1 questions here and in `design-events.md`; run the OAuth spike.**
2. **Phase 1 — platform columns + events core.** `programs.kind`/`config`, `profile_programs.role`, then `design-events.md` Phase 1 (series, occurrences, materializer, detail-page display, add-to-calendar links). Community Calls pilots.
3. **Phase 2 — GCal mirror**, per `design-events.md` Phase 2.
4. **Phase 3 — program items.** Message Box on Community Calls; Weekly Web Updates submission forms + admin digest view.
5. **Phase 4 — bids.** Community Calls-scoped first, then network-wide.
6. **On their own clocks:** `pods`/`pod_members` when the next pod round wants in-app tracking; `gumball_matches` with the gumball design doc.

## Provisional decisions

Reversible, and several hang on the questions below — react freely. Events/calendar decisions live in `design-events.md`.

| Decision | Rationale |
| --- | --- |
| `programs.kind` as the code-registry key (not slug) | Slugs stay admin-editable URL concerns; multiple rows share a kind (pod rounds) |
| Capabilities in code, knobs in `programs.config` jsonb | Components must ship as code anyway; admin-tunable values shouldn't need deploys |
| Program roles as `profile_programs.role`, two values | A role is an attribute of a membership; one column, no new table; vocabulary can grow |
| Leaving a program clears the role | A self-serve rejoin must not silently restore lead powers |
| `isAdmin \|\| isLeadOf(programId)` as the standard management gate | Programs run day-to-day without admin involvement |
| `program_items` + graduation rule | One migration covers every "box of program content"; relationship-shaped data still gets honest tables |
| Bids scoped by nullable `programId` | One table serves program-scoped and network-wide feeds |

## Key questions (prioritized)

Events and calendaring questions (mechanism go/no-go, consent posture, RSVPs, recurrence sign-off, timezones, event pages, ICS feeds) live in `docs/design-events.md`.

### P1 — decide before schema lands

1. **Bids v1 scope and response mechanics.** Program-scoped only, or network-wide too? Is a bid a broadcast (responses happen person-to-person), or does the app capture interest (`bid_interests`)? What closes a bid, and does anything expire it?
2. **Bids visibility.** Who sees a program-scoped bid — participants only, or the whole network (the relations doc's "open data, cozy UX" posture)? Same question for `program_items`; any program needing privacy makes this a per-program setting.

### P2 — decide before the affected feature ships

3. **Home-card policy.** Which programs get a home card, and for whom — only members of the program, or everyone as an advertisement? Ordering as cards multiply?
4. **`program_items` kinds and moderation.** Sign off the graduation rule and the v1 kinds (`message`, `announcement`, `event-submission`). Author edits own items; leads/admins delete — confirm.
5. **Weekly Web Updates → Buttondown composition.** How do collected submissions become the weekly email — v1 manual copy from an admin digest view, or drafting via Buttondown's API (`POST /v1/emails` groundwork already noted in `design-buttondown.md`)?
6. **Auto-subscribe and roles interplay.** `AUTO_SUBSCRIBE_SLUGS` hardcodes `weekly-web-updates` today — should auto-subscribe become a `programs` flag while we're adding columns?
7. **Lead capability matrix.** Confirm the provisional matrix above — in particular whether leads get participant add/remove and the email export (currently admin-only), which pods and calls plausibly want.

### P3 — can wait for their design docs

8. **Gumball matchmaking design.** Match lifecycle states, cadence, opt-in mechanics, and whether/when the relations graph informs matching.
9. **Service-team Tasks.** What outgrows the Trello link — what's the trigger for an in-house Tasks system, and would it start as `program_items` kind `task` or its own table (the graduation rule suggests its own, once tasks have assignees/status)?
10. **Notifications beyond calendar.** Do new bids, message-box posts, or announcements notify anyone (in-app, email digest), or is pull-only fine until it isn't?
