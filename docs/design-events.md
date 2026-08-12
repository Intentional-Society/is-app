# Design — Events and calendar invitations

Status: draft 2026-07-09 — broken out of `architecture-programs.md` during workshopping. The [prioritized key questions](#key-questions-prioritized) at the end are the review agenda; schema sketches are provisional until they're answered. Author: James (outline) + Claude (draft).

This is a design doc — concrete decisions, schema, and flows for one feature area, with rationale for future-us. It designs the first of the programs platform's shared primitives: events, singular and recurring, and the scheme for managing calendar invitations through the free Google Calendar account that handles them manually today. Platform context — design principles, `programs.kind`/`config`, program roles, UI surfaces — lives in `docs/architecture-programs.md`.

## Purpose

Programs gather: Community Calls meet every Sunday, pod rounds hold sessions, convenings happen quarterly. The app should hold those events as first-class data — queryable ("what's happening this week"), attachable (RSVPs, program pages, home cards) — and should carry them onto members' calendars without a human manually maintaining Google Calendar invitations. Community Calls' recurring Sunday call is the pilot for both halves.

## Data model

Sketches follow house schema conventions (uuid PKs, timestamptz, check constraints, `.enableRLS()`).

### `event_series` + `events`

Two tables. A **series** is the recurrence rule ("Sundays, 10:00, America/Los_Angeles"); an **event** is one concrete occurrence with real timestamps. Singular events are `events` rows with `seriesId = NULL`. A generator (cron) materializes occurrences from each active series on a rolling horizon (e.g. 90 days ahead).

```ts
export const eventSeries = pgTable("event_series", {
  id: uuid("id").primaryKey().defaultRandom(),
  programId: uuid("program_id").notNull().references(() => programs.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description"),          // markdown, per design-richtext
  location: text("location"),                // a URL for calls
  // IANA zone anchoring the recurrence math. "Sunday 10:00 in
  // America/Los_Angeles" shifts its UTC instant across DST — occurrences
  // must be computed in this zone, never as a fixed UTC offset.
  timezone: text("timezone").notNull(),
  // iCalendar RRULE string (the `rrule` npm library speaks it natively).
  // v1 admin UI emits a constrained subset — weekly/biweekly/monthly-by-
  // weekday — but the column holds the full grammar so the GCal mirror
  // can pass it through verbatim.
  rrule: text("rrule").notNull(),
  dtstart: timestamp("dtstart", { withTimezone: true }).notNull(),
  durationMinutes: integer("duration_minutes").notNull(),
  endedAt: timestamp("ended_at", { withTimezone: true }),   // series retired; stop materializing
  gcalEventId: text("gcal_event_id"),        // the mirrored recurring GCal event
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}).enableRLS();

export const events = pgTable("events", {
  id: uuid("id").primaryKey().defaultRandom(),
  programId: uuid("program_id").notNull().references(() => programs.id, { onDelete: "cascade" }),
  seriesId: uuid("series_id").references(() => eventSeries.id, { onDelete: "cascade" }), // NULL = singular
  title: text("title").notNull(),            // copied from series at materialization; editable per-occurrence
  description: text("description"),
  location: text("location"),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
  status: text("status").notNull().default("scheduled"),    // 'scheduled' | 'cancelled'
  editedAt: timestamp("edited_at", { withTimezone: true }), // set on per-occurrence edit; re-stamps skip these
  gcalEventId: text("gcal_event_id"),        // the mirrored GCal instance (or standalone event)
  createdBy: uuid("created_by").references(() => profiles.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}).enableRLS();
```

**Why materialized occurrences rather than expanding the RRULE at query time:** per-occurrence state needs rows anyway — cancelling one Sunday call, moving another, attaching RSVPs or a GCal instance id. Materializing makes "what's happening this week" a plain indexed query and makes occurrence exceptions ordinary row edits. The cost is a small generator cron, which the app's cron infrastructure already accommodates.

**Series-edit precedence (v1 policy):** editing a series re-stamps its *future, unedited, uncancelled* occurrences; an occurrence with `editedAt` set or `status = 'cancelled'` keeps its local state. Editing an occurrence never touches the series.

**Network-wide events** (e.g. a Quarterly Convening, anticipated by `design-relations.md`) keep `programId` non-null: a convening is itself a program (or lives under a standing "Convenings" program). One less nullable FK, and visibility/membership semantics come along for free.

**Permissions:** a program's leads and admins manage its series and occurrences (`role = 'lead'` on `profile_programs` — see `architecture-programs.md`).

### `event_rsvps` (provisional — gated on Q3)

```ts
export const eventRsvps = pgTable(
  "event_rsvps",
  {
    eventId: uuid("event_id").notNull().references(() => events.id, { onDelete: "cascade" }),
    profileId: uuid("profile_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
    status: text("status").notNull(),        // 'yes' | 'no' | 'maybe'
    respondedAt: timestamp("responded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.eventId, table.profileId] })],
).enableRLS();
```

If the GCal mirror lands, Google already collects RSVPs on the invitation — this table may hold a read-back mirror of those responses, in-app responses, or nothing at v1. Q3 decides.

## Calendar invitations

### Goal and invariant

Events managed by the app should reach members' calendars through the existing free Google Calendar account, replacing today's manual invitation work. In the Buttondown style, the invariant the sync enforces:

> Every calendar-synced app event exists on the IS Google Calendar with time, title, and location matching the app's record, and with its attendee list equal to the current participants of its program.

### Verified constraints (2026-07)

These four facts bound the design space; sources linked.

1. **A service account is not an option.** The Calendar API rejects attendee invitations from service accounts without Domain-Wide Delegation ([error thread](https://support.google.com/calendar/thread/299552457/service-accounts-cannot-invite-attendees-without-domain-wide-delegation-of-authority?hl=en)), and DWD requires a Google Workspace domain — the IS account is a free consumer account. The write path must be OAuth *as* that account.
2. **OAuth consent-screen status decides token lifetime.** A Google Cloud project whose consent screen sits in "Testing" issues refresh tokens that [expire after 7 days](https://www.unipile.com/google-oauth-refresh-token/). The consent screen must be published to "In production" for a long-lived refresh token. The Calendar scope is *sensitive*, so an unverified production app shows a warning screen during consent and caps at 100 users — both fine, since exactly one account (ours) ever consents. **Verification spike required** (Q1): confirm a production-unverified consent with the Calendar scope yields a refresh token that survives past 7 days before building on it.
3. **"Known senders" invitation filtering.** Google Calendar [auto-adds invitations only from known senders](https://support.google.com/calendar/answer/13159188) — in contacts, or previously interacted with. Members who have never touched the IS calendar account get an email-only invitation until they interact once. Mitigation: most members already receive the manual invites today, and "add the IS calendar address to your contacts" becomes a welcome-flow line item.
4. **Consumer-account abuse limits are far above our scale.** The thresholds that trip Google's [calendar use limits](https://support.google.com/a/answer/2905486?hl=en) — on the order of 10,000 external invites, 750 shares in a burst ([usage limits](https://developers.google.com/workspace/calendar/api/guides/quota)) — are orders of magnitude beyond a 50–100 member network with a handful of weekly events.

### Options

**A. GCal API mirror via OAuth on the existing account (recommended).** One-time OAuth consent by the account owner; the refresh token becomes a production env secret. The app creates and updates events on the IS calendar with member emails as attendees and `sendUpdates: "all"`, so Google carries invitations, updates, cancellations, reminders, and RSVP collection. Invitees on Outlook/Apple/etc. still get standard iMIP invitation emails — GCal-as-sender covers non-Google members too. A series mirrors as one recurring GCal event (one invitation covers every Sunday; the RRULE column passes through verbatim); per-occurrence exceptions map to instance edits.

**B. App-sent iCalendar (iMIP) invitations via Resend.** The app emails `METHOD:REQUEST` ICS itself. Full control and no Google dependency, but we own the UID/SEQUENCE lifecycle, RSVPs come back as email replies needing parsing (or get dropped), the sender starts with zero interaction history (worst case for constraint 3), and deliverability is on us. The fallback if A's token spike fails.

**C. Published ICS subscription feeds.** Tokened per-program (or per-member) feed URLs members subscribe to once. No invitation emails, no RSVPs, and Google refreshes external feeds on its own schedule (hours to a day) — weak for last-minute changes. A cheap later complement, especially for members who prefer pull over invites.

**D. Add-to-calendar affordances.** Per-event "Add to Google Calendar" template links and ICS downloads on event pages. Zero infrastructure and no update propagation; ships with the first event UI regardless of the invitation scheme, and remains the fallback affordance permanently.

### Recommended scheme: A + D, Buttondown-shaped

Ship D with the first event pages. Build A as a sync reusing the Buttondown architecture (`docs/design-buttondown.md`) piece for piece:

- **Managed universe:** the sync only touches GCal events carrying `extendedProperties.private.appEventId`. Hand-created events on the same calendar are invisible to it — humans remain co-authors of the calendar, exactly like human-set Buttondown tags.
- **Write paths:** inline best-effort push on event create/edit/cancel and on membership join/leave (attendee add/remove), Sentry-logged and swallowed on failure; a reconciler cron is the correctness guarantee, diffing app state against the managed universe.
- **Concurrency and gating:** a `sync_locks` row (`'gcal'`), a `GCAL_SYNC_WRITE` env write-gate as the dry-run mechanism, credentials present only in the Production env scope, structured Axiom logging with a per-run summary.
- **Consent posture:** joining a calendar-synced program is consent to receive its invitations, mirroring the Buttondown transactional posture — the program description must say the calendar invitations come with membership. Leaving the program removes you from future attendee sets. (Q2 confirms; a per-member opt-out column is a cheap later add.)
- **Per-program opt-in:** which programs sync, and to which calendar, hangs off `programs.config` — the `buttondownTag`-style null-means-never switch.

RSVP read-back (attendee `responseStatus` on the mirrored event) is available whenever we want attendance signals in-app; whether we want it is Q3.

## Event UI

v1 renders upcoming events on the program detail page (a shared component the `kind` registry's sections can also embed), each with its add-to-calendar affordances (option D). Dedicated event landing pages (`/programs/[slug]/events/[id]`) come when something needs a linkable URL — a calendar invitation description pointing back into the app is the likely trigger (Q6).

## Rollout

Each phase is independently shippable; expand-step migrations land ahead of code per `strategy-committing.md`.

1. **Phase 0 — OAuth spike.** A throwaway script proves (or refutes) the long-lived refresh token on a production-unverified consent (constraint 2). Go/no-go for option A; B is the fallback.
2. **Phase 1 — events core.** `event_series`, `events`, the materializer cron, event display on program detail pages, add-to-calendar links (D). Community Calls' Sunday series is the pilot.
3. **Phase 2 — GCal mirror (A).** Behind `GCAL_SYNC_WRITE` dry-run gating, Community Calls as proving ground, then per-program opt-in via config.

## Provisional decisions

Reversible, and several hang on the questions below — react freely.

| Decision | Rationale |
| --- | --- |
| Materialized occurrences over query-time RRULE expansion | Per-occurrence state (cancellation, edits, RSVPs, GCal instance ids) needs rows anyway; queries stay plain |
| Recurrence stored as an RRULE string, UI constrained to a subset | Full grammar for the GCal pass-through; simple admin UI; `rrule` npm does the math |
| Series carries an IANA `timezone` anchor | DST correctness for "Sunday 10:00 Pacific" in a global network |
| Events always belong to a program | Network-wide events live under a program (e.g. Convenings); no nullable FK, visibility follows membership machinery |
| GCal mirror reuses the Buttondown sync pattern | Invariant, managed universe, inline + cron, lock, dry-run gate — all proven in this codebase |
| Series mirrors as one recurring GCal event | One invitation covers the whole series; exceptions map to instance edits |
| Leads and admins manage a program's events | Follows the program-roles model in `architecture-programs.md` |

## Key questions (prioritized)

1. **Calendar mechanism go/no-go.** Confirm option A (OAuth GCal mirror) as the target, contingent on the Phase-0 spike: does a production-unverified consent with the Calendar sensitive scope yield a refresh token that outlives 7 days? If not: fall back to B (app-sent iMIP via Resend) or escalate (paid Workspace? verification process?).
2. **Calendar consent posture.** Is joining a calendar-synced program itself consent to receive its GCal invitations (the Buttondown transactional posture — recommended), or do members need a separate calendar opt-in/out from day one?
3. **RSVPs and attendance.** Does v1 need RSVP state in-app at all? If yes, which is the source of truth — GCal attendee responses read back by the sync, or an in-app RSVP control writing `event_rsvps`? And separately: do we care about *actual attendance* (who showed up) as data for pods/gumball/community health?
4. **Recurrence model sign-off.** Materialized rolling-horizon occurrences, the constrained RRULE subset, and the series-edit precedence policy (re-stamp future unedited occurrences; edited/cancelled ones keep local state) — confirm or adjust.
5. **Timezone display.** Render event times in the viewer's browser-local zone everywhere (no profile column needed), with the series anchor zone shown alongside? Any case for a profile timezone field?
6. **Dedicated event pages.** Do events need their own landing URLs at v1 (calendar invitations linking back into the app), or is the program detail page enough until then?
7. **ICS feed complement (option C).** Worth adding for pull-preferring members once the mirror works?
