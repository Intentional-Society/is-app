# Design — Relations (the relationship web)

Status: design captured 2026-05-04. Not yet implemented. Author: collaborative interview between James and Claude.

This is a design doc — concrete decisions, schema, and flows for one feature, with rationale captured for future-us. It sits between strategy (less prescriptive than `strategy-*`) and architecture (less sweeping than `architecture-*`).

## Purpose

The Relations feature collects, stores, and surfaces the relational data that makes IS a network rather than a directory. Two declared outcomes:

1. **Visible trust.** Members can see their connections and their connections' connections — the substrate that makes weak-tie introductions and async coordination tractable. Success: members meet beneficially, find their groupings (dyads, pods, interest groups, congregations), and feel the "find the others" resonance.
2. **Coordination.** The graph is substrate for action — features that surface "I want to do X, who's available?" matchmaking, with the network as filter and ranker. Success: a member takes action they wouldn't have taken otherwise, and not alone.

The relations data model is shared between both legs. Visible-trust hooks come first; coordination features layer on top.

## Design principles

### Mesh, not graph-with-a-center

Every member sits at the center of their own graph. The system has no global "view from nowhere" — no leaderboards, no canonical centrality scores, no admin god-view of the whole network. Every UI is from a perspective; every search is personally weighted. The handful of admin-curation surfaces (e.g. hint-seeding) are a deliberate exception and live separately from the member-facing app.

### Doubly unidirectional

A's view of B and B's view of A are stored separately and can differ. Most network tools symmetrize edges into a single value, which loses information; "I think we're close, they don't" tells both parties something real. Asymmetry is part of what gets visualized as data.

### Open data, cozy UX

The data model is open — any member can read any relation. The cozy feeling comes from defaults and surfacing, not from access control: the app lands on your personal subgraph, with the broader-graph and traversal modes present in a secondary surface (think Mastodon's federated timeline — available, not foregrounded). RLS on `relations` mirrors the rest of the schema (deny-by-default at the role layer, with the Hono API as the single read path).

### Personal subgraph as primary view

The MVP visualization is *you, and 1–2 hops out*. Whole-network views are boring at low edge density and overwhelming once dense; 2-hop subgraphs deliver the "that's neat" hit at any density and ground the experience in the member's perspective.

### One dimension at MVP

A single value from a small set captures both "visible trust" and resonance, with room to add dimensions later. Drafted vocabulary (subject to refinement, worth member testing before committing):

- `1` — we've met in group settings and know of each other.
- `2` — we've spent some time talking 1-on-1 enjoyably.
- `3` — friend.
- `4` — deep trust and knowing.

The absence of a relation is an absence of a row. There is no explicit "0 / no connection of interest" rating — un-rated suggestions simply re-surface in future feeds, and at MVP scale (50–100 members) that's a non-problem. A future "intentional dissonance" value (`-1`) is also deferred — the social cost of publicly logged negative feelings wants more design care than we have lived experience to provide right now.

## Data model

### `relations`

The core table. One row per directed (relator → relatee) pair. Composite PK because there is exactly one relation per direction per pair.

> Vocabulary note: TS-side field names (`relatorId`, `relateeId`, `relationValue`) reflect the post-PR-2 review pass. The SQL column names (`rater_id`, `ratee_id`, `creator_value`) and constraint names (`invites_creator_value_range`) still match the PR-1 migration; a rename migration will close the gap.

```ts
export const relations = pgTable(
  "relations",
  {
    relatorId: uuid("rater_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    relateeId: uuid("ratee_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    value: integer("value"), // null only when isHint=true; otherwise 1..4
    isHint: boolean("is_hint").notNull().default(false),
    hintedBy: uuid("hinted_by").references(() => profiles.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    primaryKey({ columns: [table.relatorId, table.relateeId] }),
    check("relations_no_self", sql`${table.relatorId} != ${table.relateeId}`),
    check(
      "relations_value_range",
      sql`${table.value} IS NULL OR (${table.value} BETWEEN 1 AND 4)`,
    ),
    check(
      "relations_hint_state",
      sql`(NOT ${table.isHint} AND ${table.value} IS NOT NULL)
       OR (${table.isHint} AND ${table.value} IS NULL)`,
    ),
  ],
).enableRLS();
```

Two valid row states:

- **Confirmed rating.** `value` ∈ 1..4, `isHint = false`. `hintedBy` may or may not be set (preserving the trail of who originally seeded it, even after confirmation).
- **Pending hint.** `value` IS NULL, `isHint = true`. `hintedBy` is set on creation (the API requires it), but the FK is `onDelete: set null` so a hint can become anonymous if the hinter's profile is deleted. The check constraint accepts `hintedBy IS NULL` to make this safe.

A hint becomes a confirmed rating by setting `value` and flipping `isHint` to false.

Sparse representation: there is no row for "haven't been shown" or "haven't acted" — that state is `(no row in relations)`. Cost: no "deferred / ask me later" affordance — at 50–100 members the suggestion pool is small enough that simply re-surfacing un-rated suggestions each visit is fine. Revisit if the feed gets noisy.

### `invite_hints`

Hints created at invite-code creation time, materialized into `relations` rows when the invite is redeemed. Needed because the relator (the to-be-invitee) doesn't exist as a profile yet.

```ts
export const inviteHints = pgTable(
  "invite_hints",
  {
    inviteId: uuid("invite_id")
      .notNull()
      .references(() => invites.id, { onDelete: "cascade" }),
    relateeId: uuid("ratee_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.inviteId, table.relateeId] })],
).enableRLS();
```

On invite redemption, for each row in `invite_hints` keyed to that invite, insert a `relations` row: `relatorId = redeemer's profile`, `relateeId = inviteHints.relateeId`, `isHint = true`, `value = null`, `hintedBy = invites.createdBy`. The new member opens the app and finds their suggestion feed already populated with the inviter's hypotheses — the moment of invite is the moment the inviter pre-seeds the new member's web.

Asymmetric activation: the hint creates only the new-member→other-member row. The other member picks up the new member organically once the new member rates them, via the "people who've rated me" suggestion signal.

Inviter UI: hints are added through a typeahead-member-search widget below the "who is this" / `creator_value` inputs on the invite form — start typing a member's name, pick from the autocomplete, accumulate hint chips. Each chip becomes one `invite_hints` row when the form submits.

### `profiles.last_updated_web`

One column added:

```ts
lastUpdatedWeb: timestamp("last_updated_web", { withTimezone: true }),
```

Bumped when the user clicks the **Done** button at the end of a build session (see Build/View flow below). Used by other members' "who's been recently active" suggestion signal. Real-time edits to relations don't bump this — only the explicit Done click does, capturing intent rather than activity.

### `invites.creator_value`

One column added to the existing `invites` table:

```ts
relationValue: integer("creator_value"), // 1..4 if set; null allowed for admin-issued invites
```

Plus a check constraint `invites_creator_value_range` enforcing `creator_value IS NULL OR creator_value BETWEEN 1 AND 4`.

The inviter declares their relation to the invitee at invite-creation time, immediately after the "who is this?" input. The picker offers 1–4 (the same vocabulary as the rating dialog). A soft warn at 1 nudges the inviter to reconsider: weak-tie invites tend to make for weak community fit, and we'd rather members invite people they actually have a relation with. Admin-issued invites may leave the value null.

On invite redemption, if `relationValue IS NOT NULL`, materialize a `relations` row: `relatorId = invites.createdBy`, `relateeId = invites.redeemedBy`, `value = invites.relationValue`, `isHint = false`, `hintedBy = null`. The new member opens the app and finds their inviter at the top of the suggestion feed via the "people who've rated me" signal — the warmest possible first interaction.

The column doubles as a soft quality gate on invitations. The <2 soft-warn keeps the bar at "we've at least had a 1-on-1 conversation," which makes the invitation itself a more meaningful signal in the network.

The redemption Hono handler performs both materializations (the `relationValue` row, plus any `invite_hints` rows) in the same database transaction as setting `redeemedBy` / `redeemedAt`. A partial redemption cannot leave the suggestion feed unpopulated.

### Hint sources

| Where | Becomes a row in | Constructed by |
| --- | --- | --- |
| Inviter, at invite-code creation | `invite_hints`, then `relations` on redemption | The inviter, optionally, when generating the code |
| Superconnector, post-signup | `relations` directly | Admin tooling — separate surface, gated by `profiles.is_admin` |

The two paths converge into the same row shape; downstream queries don't need to distinguish them beyond `hintedBy`.

## Key flows

### Welcome tour (signup)

The "welcome page" expands into a guided multi-step tour. Steps land on real app pages with overlay guidance (recommendation: `react-joyride` — Next.js-friendly, mature, handles a11y); each page is independently usable later via direct navigation.

1. **Welcome.** Brief framing of IS Web and what the next ~2 minutes will set up.
2. **Profile.** Edit the standard profile fields.
3. **Relations: meet your suggestions.** The suggestion feed renders, pre-populated. The inviter sits at the top — their relation to the new member was materialized from `invites.creator_value` at redemption, so they show up as the strongest "people who've rated me" signal. Below them, the invite's hint rows. New suggestions appear as ratings happen (the inviter's high-rated connections, anyone else who has already rated the new member).
4. **See your web.** Personal subgraph view — the user themselves at center, their newly rated connections at one hop. The Done button transitions from edit to view mode and bumps `last_updated_web`.

### Edit mode ↔ View mode

The personal subgraph is always displayed, regardless of mode — the web is the page, not a tab. Mode toggles only what surfaces around it:

- **Edit mode.** Suggestion feed visible below the graph (single column on mobile, grid on desktop). Cards are clickable to open the rating dialog. Edits persist in real time, and the graph re-renders optimistically as ratings happen.
- **View mode.** Suggestion feed hidden. The graph is the only content, oriented toward exploration and reading.

The toggle is a paired **Edit** / **Done** button — Edit in view mode, Done in edit mode. **Done** has one side effect: bumping `last_updated_web` on the user's profile — a signal of "I'm done updating for now," used by other members' "recently active" suggestion signal. Real-time persistence means no batched save is happening; the button captures intent, not state. Members can re-enter edit mode any time.

### Suggestion feed sources

Surfaced in approximate priority order. At MVP scale (50–100 members), simpler-than-described is fine — start with one or two sources and add the rest as the feed thins out.

1. **People who have rated me.** The strongest signal — a real person has unambiguously declared interest. Query: `relations.relateeId = me, value IS NOT NULL`, joined against the absence of a reciprocal row from me.
2. **Pending hints for me.** `relations.relatorId = me, isHint = true`. Includes both invite-time hints and post-signup superconnector hints. The `hintedBy` value provides the "James suggests…" attribution.
3. **My inviter's higher-rated connections.** Rows where `relator = my profiles.referredBy` and `value >= 3`, minus people I've already rated.
4. **Recently active members.** Profiles whose `last_updated_web > my last_updated_web`, minus people I've already rated.
5. **Everybody else.** The rest of the directory — profiles minus me, minus anyone I've already rated or hinted at, minus anyone surfaced by sources 1–4. Ordered `last_updated_web DESC NULLS LAST, displayName ASC` so engaged-but-not-recent members lead and dormant members tail in.

Sources 1–4 carry an explicit "reason" surfaced in the UI (`addedYou` / `hintedBy <name>` / `via <inviter>` / `recently active`) — a sub-line that grounds the suggestion in something legible. Source 5 has no derived signal and renders without a reason chip.

The asymmetry-visibility ethos: when someone shows up because they rated me, I don't see their rating before responding. This is a soft UI hiding, not a hard constraint, and I see their rating on the completed two-way relation.

The feed is rendered in two sections:

- **Suggestions.** All four signal-bearing sources (1–4). Auto-hides when empty, giving the user a small "caught up" moment once the algorithmic queue is cleared.
- **Other members.** Source 5 — the rest of the directory, so the feed never goes empty while there's still anyone left to relate to. Visible whenever there is anything to show in edit mode.

### Rating a suggestion

Clicking a suggestion card opens a small modal:

- A vertical column of four buttons labeled **1**, **2**, **3**, **4**, each next to its vocabulary description. Clicking a button sets the rating and closes the dialog — no separate Save step.
- Numeric keystrokes 1–4 are caught as a backup shortcut, equivalent to clicking the matching button.
- Clicking outside the dialog dismisses it and cancels — no relation is created. The suggestion remains un-rated and re-surfaces in a future feed cycle.
- For hint cards (`isHint = true`), the dialog surfaces the `hintedBy` attribution ("James suggested you know this person"). Selecting any of 1–4 confirms the hint: `value` is set, `isHint` flips to false.
- For "people who rated me" cards, the relator's value of me stays hidden in the dialog (consistent with the soft-UI-hide policy) and is revealed once I've responded.

On rating, the mutation goes through Hono RPC; TanStack Query optimistically updates the local cache so the graph re-renders with the new relation before the server round-trip completes. Failed mutations revert with an error toast.

### Personal subgraph view

The graph is rendered with `react-flow` — chosen for native React integration, click-on-edge / click-on-node support, and clean interop with TanStack Query optimistic updates. Identical in edit and view modes; the only mode-driven difference is whether the suggestion feed appears below it. Center node: the viewing member. Relations shown:

- Outgoing relations (`relator = me`, `value IS NOT NULL`). Show value as edge thickness or label.
- Optional toggle: Incoming relations (`relatee = me`, `value IS NOT NULL`). Asymmetry rendered as paired counter-edges, one per direction — consistent with the doubly-unidirectional model.
- Optional toggle: One additional hop: relations of my first-degree connections (their relations to each other and to second-degree members).

Hint rows (`value IS NULL`) are filtered out of the visualization. They live on the suggestion feed instead.

**Click behavior** (same in both modes):

- **Edge (relation) click** — opens the rating dialog pre-filled with the current value. Same dialog component as the suggestion-feed rating flow; selecting a new 1–4 updates `value` and re-renders. Outside-click cancels with no change.
- **Node (person) click** — navigates to that person's profile page.

**Small-N rendering.** A brand-new member's first graph has 1–3 nodes (themselves, their inviter, maybe a confirmed hint or two). The graph component must render gracefully at these sizes — a single node should look intentional. Test cases at N = 1, 2, 3 are part of the implementation acceptance criteria.

Whole-network views are out of scope at MVP. The data model permits them — anyone with a reason to (e.g. James working on community design) can construct one — but the app surface doesn't promote them.

## SumApp comparison and what we want to do better

The predecessor here is SumApp + Kumu, used at Limicon 2024 and 2025. Specific pain points to design against:

- **Random-ordered grid of all members.** Replaced by the suggestion feed, ordered by signal (people who rated you > hints > inviter's connections > recently active).
- **No hover detail.** Each suggestion card surfaces enough profile information to make a rating decision without navigating away.
- **No multiselect.** Some affordance for multi-select will let you tap/click multiple people and assign them the same rating.
- **No "what's new since last visit."** `last_updated_web` and the recently-active suggestion signal address this directly.
- **Static, no responsiveness.** Real-time RPC persistence, optimistic UI updates via TanStack Query.

The design assumes a cold start from current IS Web signups. Limicon data is not imported.

## Decisions captured

These are choices made during the design interview. Each is reversible but reflects current thinking.

| Decision | Rationale |
| --- | --- |
| One dimension, 4 values (1..4) | Capture visible-trust and resonance with the smallest possible model. Add dimensions later if needed. |
| No explicit `0` rating | Considered and dropped. Un-rated suggestions re-surface in the feed; the only state distinction is "have row, value 1..4" vs "no row." Simpler dialog, simpler check constraints, fewer affordances to design. |
| Doubly unidirectional, no symmetrization | Asymmetry is information, and people can see it. |
| Open data model, cozy UX layer | Members can see all relations in principle; the app's defaults make exploration deliberate. |
| Sparse state, no `suggestion_state` table | No row = no interaction. Trade-off: no "deferred / ask me later" — re-surface un-rated suggestions each visit. |
| Hints are just hypothesized relations (`isHint`, `hintedBy`) | One table, one shape, two row states. Avoids a parallel `hints` table. |
| Invite-creation hints (separate `invite_hints` table, materialized at redemption) | Inviter pre-seeds the new member's suggestion feed at the moment of code generation; new members land on a populated, warm web rather than just one inviter edge. |
| Inviter rates the invitee at invite creation (`invites.relationValue`) | Materialized as a confirmed `relations` row at redemption — the inviter is the new member's warmest first suggestion via "people who've rated me." Doubles as a soft invite-quality gate; the <2 warn nudges members toward inviting people they actually have a relation with. |
| Hint activation is asymmetric | One row per hint (new member → existing member); the other side picks up via "people who rated me" once the new member rates. |
| Personal subgraph (≤2 hops) is the primary view | Whole-network is boring sparse and overwhelming dense; 2-hop subgraphs deliver the "that's neat" hit at any density. |
| `last_updated_web` bumped on explicit Done click | Captures intent rather than real-time activity. Quiet edits stay quiet. |
| Real-time persistence, not batched | Done captures intent only; data is saved as edits happen. |
| Quarterly Convening refresh out of scope here | Will fit into a future events table; not modeled in the relations design. |
| Tour library: `react-joyride` | Next.js-friendly, handles keyboard/a11y, saves us rolling our own. |
| No Limicon data import | Cold start from IS Web signups. |

## Deferred / future

- **Inferred relations from in-app activity** (event co-attendance, thread participation). Layer on top of self-declared data once the core feature lands.
- **Quarterly Convening as refresh ritual.** Once the events table exists, "your last update was before the winter convening — refresh before Saturday's gathering" becomes a first-class nudge.
- **Coordination feature leg.** Posting board / matchmaker that uses the graph as filter/ranker. Layered on top of relations once data density is reasonable.
- **`-1` "intentional dissonance" rating.** Skipped at MVP; revisit with lived data.
- **Whole-network browsing modes.** Permitted by the data model, deferred from the MVP UX.
- **Embedded subgraph displays on member profile pages.** A read-only `WebGraph` centered on the profile's member, alongside their bio. The data model already supports this — the `WebGraph` component is being built parameterized on `centerMemberId` so this slots in without rework. Visibility specifics (full personal subgraph at 2 hops vs. first-degree only, hint exclusion) to settle when this lands.

## Open questions

- **Hint edit / withdrawal.** If a hint is wrong, can the relator dismiss it without rating? At MVP: any of 1–4 confirms the hint; outside-click cancels and leaves the hint in place to re-surface next visit. There is no "delete this hint" affordance for the relator. Likely fine; revisit if hints become a source of friction.
- **Vocabulary refinement.** The 1–4 labels are a draft. Worth user-testing with a handful of members before committing.
