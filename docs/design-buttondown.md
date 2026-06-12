# Design — Buttondown sync

Status: design captured 2026-05-22; implemented in #280 and fully cut over 2026-06-12 — the app is the sole writer of program tags. Author: collaborative interview between James and Claude.

This is a design doc — concrete decisions, schema, and flows for one feature, with rationale for future-us. It sits below `architecture-appstack.md` and above the code.

## Purpose

Some IS programs *are* a newsletter — most obviously `weekly-web-updates`, where the program description will read as "join this and receive a weekly email." Buttondown is where those emails are composed and sent. This document describes how the app keeps the relevant Buttondown subscriber tags in step with current program membership, without members ever needing to know Buttondown exists.

## Context: the Apps Script flow this replaced

Before the app existed, IS Web signups were collected via a Google Form. A Google Apps Script triggered on each Form submission to upsert the respondent into Buttondown and tag them. That pipeline tagged every Form-filler `new` (joined IS Web fresh) or `returning` (was an IS member predating IS Web who later signed up for IS Web). The audience also includes a larger non-member population who subscribed to the newsletter directly through Buttondown — these people are not in our profiles table and were never touched by the Apps Script.

The app's sync **replaced** the Apps Script as the writer of program tags; the cutover completed 2026-06-12 with the Apps Script trigger disabled and the Form retired in favor of the app's invite/signup flow. The sync inherited the existing tag names and the `new`/`returning` vocabulary, so nothing in Buttondown needed rewriting on cutover.

## The invariant

One sentence the whole integration enforces:

> A member who has saved their profile should exist as a Buttondown subscriber, tagged exactly according to their current memberships in programs that have a `buttondownTag` set.

Every code path below is a route to making that statement true.

## Source of truth

- The app owns **who is in which program** (`profile_programs`, `leftAt IS NULL` = current).
- Buttondown owns **delivery state** — whether a subscriber is active or unsubscribed, and any tags humans set directly in the Buttondown UI.
- The sync reads Buttondown (subscriber existence, current tags, unsubscribe state) so it can write without clobbering human-authored tags or pushing email to people who've explicitly opted out. The only sustained write target is Buttondown. There's one exception by design: a Buttondown unsubscribe is treated as a real-world signal that the person is no longer participating, and the cron alerts a human to review — see [Unsubscribe handling](#unsubscribe-handling).

## Consent posture

Program-driven emails are treated as **transactional**, not marketing. A program whose entire description is "receive a weekly email" makes consent explicit by the act of joining; leaving the program is the unsubscribe. Members do not need to know Buttondown is the delivery vehicle, and we deliberately avoid a separate "newsletter opt-in" checkbox — it would imply joining a "weekly email" program is *not* itself consent, which would be confusing.

What this implies in code:

- The act we treat as opt-in is **joining a program with a non-null `buttondownTag`**.
- The act we treat as unsubscribe (app-side) is **leaving that program in the app**. The Buttondown unsubscribe link still works and is treated as a separate, stronger real-world signal — see [Unsubscribe handling](#unsubscribe-handling).
- Every program with a non-null `buttondownTag` must carry a description that makes the email obligation explicit ("join this and receive a weekly email"). The act of joining — whether via auto-subscribe, the welcome flow, or admin add — is the consent, so the program copy has to actually describe the email for that consent to be informed.

## What gets synced

### Tag namespace

Each `programs` row carries a nullable `buttondownTag text` column. The column's value is the **exact** Buttondown tag name we manage for that program — set to the same string the Apps Script was already writing (e.g. whatever `weekly-web-updates` corresponds to in the existing audience). Null means "do not sync this program to Buttondown at all." This decouples the public-facing program slug from the Buttondown tag, gives admins per-program control without a code change, and means the cutover from Apps Script involves no recipient-facing tag rename.

We identify "tags we manage" by joining against the `programs` table: the set of Buttondown tags under our authority is `SELECT DISTINCT buttondownTag FROM programs WHERE buttondownTag IS NOT NULL`. We never touch tags outside that set.

### Identity

Subscribers are keyed by email. We use `auth.users.email` for the matching member's profile id — the same email Supabase signs them in with. There is no separate "newsletter email" field. Edge case: members who already exist in Buttondown under a different email won't be matched; that's an acknowledged limitation.

### Standing tags: `isweb-member`, `new`, `returning`

Three tags carry signup-moment semantics — the app writes them when a subscriber first arrives via IS Web, and the daily cron never modifies them after that:

- **`isweb-member`** — applied to every Buttondown subscriber the app touches as an IS Web member. The persistent "this person is in IS Web" marker, regardless of any specific program.
- **`new`** — applied when the app creates a fresh Buttondown subscriber at first profile save.
- **`returning`** — applied when the app finds the email already exists in Buttondown at first profile save.

`new` and `returning` are mutually exclusive at any given creation event. All three are set during the inline first-profile-save full-overwrite (see [Write policy](#write-policy)); after that they're treated as authoritative origin records and the cron's diff-only path explicitly excludes them from its managed universe.

### The legacy `active` tag

A vestigial pre-cutover tag we want to clear. The first-profile-save full-overwrite handles new members; the [initial bootstrap reconciliation](#initial-bootstrap-reconciliation) handles existing ones.

## Code paths

Two paths, both enforcing the invariant.

### Write policy

The inline first-profile-save path is the **one moment** the app does an authoritative full-overwrite of a subscriber's tags. Every other write (the daily cron) is a diff-only PATCH that preserves anything outside our managed tag universe — including human-set Buttondown tags and the legacy `new`/`returning` markers. The signup moment is the only point at which we have the standing to assert "this is the tag set, period"; after that, humans editing in the Buttondown UI are co-authors of the tag state and we don't fight them.

### 1. Inline hook on first profile save

When a member saves their profile and `profiles.lastUpdatedProfile IS NULL` *before* the update:

1. Fetch the member's email from `auth.users`.
2. Compute the desired program-tag set from their current `profile_programs` rows joined to programs with non-null `buttondownTag`.
3. GET the Buttondown subscriber by email.
   - **Missing** → POST to create with tags = `[…program_tags, "isweb-member", "new"]`. Store the returned subscriber id on `profiles.buttondownSubscriberId`.
   - **Unsubscribed** → don't write. Raise an [unsubscribe alert](#unsubscribe-handling) so a human can decide whether this person should be in IS Web at all. Profile save still succeeds.
   - **Active, existing, already has `isweb-member`** → no-op. The app has authoritatively written this subscriber on a previous run; doing another full-overwrite now risks clobbering tags a human has added in the Buttondown UI since. The cron's diff-only path handles any program-tag drift.
   - **Active, existing, no `isweb-member`** → PATCH with a **full overwrite** of tags = `[…program_tags, "isweb-member", "returning"]`. This is the one moment we authoritatively reset. Record the subscriber id on `profiles.buttondownSubscriberId`.
4. Failure logs to Sentry and is **swallowed** — the profile save succeeds regardless. The cron picks up any miss, and any human tags lost to the overwrite were lost at a discrete known moment that admins can mentally bracket.

This path exists only to shorten the new-member time-to-first-email. It is a latency optimization, not a correctness guarantee. The cron is what we trust.

### 2. Daily reconciler (Vercel cron)

`GET /api/cron/buttondown-sync`, scheduled daily at **08:00 UTC** via `vercel.json` `crons`, gated by a `CRON_SECRET` bearer check. (Vercel cron invokes endpoints via HTTP GET.) Acquires the [sync concurrency lock](#concurrency-lock) before doing any work and releases it at the end.

For each profile where `lastUpdatedProfile IS NOT NULL`:

1. Compute the desired managed-tag set from the profile's current memberships.
2. Look up the Buttondown subscriber. If `profiles.buttondownSubscriberId` is set, GET by id (stable across email changes); otherwise GET by `auth.users.email`.
   - **Missing**: POST to create with tags = `[…desired, "isweb-member", "new"]`. Store the returned id on `profiles.buttondownSubscriberId`. (This is the catch-up case for a failed inline write.)
   - **Unsubscribed**: don't write. Raise an [unsubscribe alert](#unsubscribe-handling).
   - **Found by id but email differs from `auth.users.email`**: PATCH the subscriber's `email` field to the current app email. Then continue with tag diffing.
   - **Found by email** (no stored id yet): record the id on `profiles.buttondownSubscriberId` for next time. Then continue with tag diffing.
   - **Subscribed**: compute `(subscriber.tags ∩ managed_universe) Δ desired`. PATCH only if the diff is non-empty. Preserves human-set tags and the `isweb-member` / `new` / `returning` markers because they're outside the managed universe.

Output a structured summary to the dedicated Axiom dataset (see [Logging](#logging)): members scanned, subscribers created, tags added, tags removed, emails updated, unsubscribes flagged, errors.

**The loop is over `profiles`, not over Buttondown subscribers.** The non-member newsletter audience is larger than our profiles table and is never touched by this code — if an email doesn't have a profile row, the cron has nothing to say about it. This also means the sweep step is implicit: a profile that left a program contributes a tag to `current ∩ managed_universe` but not to `desired`, so the diff naturally schedules the tag removal. No separate Buttondown-side enumeration is needed.

### Why not inline-on-every-membership-change

Considered and rejected for v1. Every join/leave would need a Buttondown call, every failure would need a retry queue, and out-of-band changes (admin SQL fixes, the `addParticipant` admin path) would each need to remember the call. The cron handles all of those cases uniformly. If a latency need below "one day" surfaces, add an inline call to `joinProgram` / `leaveProgram` as a fast path; the cron is still the safety net.

## Unsubscribe handling

A Buttondown unsubscribe is a stronger signal than "I don't want this specific program's emails" — it's a person actively saying "stop emailing me." The current convention is that the only emails an IS Web member receives via Buttondown are program-driven, so an unsubscribe effectively says "I don't want to be in any of these programs anymore," and possibly "I don't want to be in IS Web." That's a membership question, not a tag-sync question.

When the cron or the inline path encounters a Buttondown subscriber that is unsubscribed and whose email maps to an IS Web profile:

1. **No write to Buttondown.** Their unsubscribe is sacred — we do not re-tag, re-subscribe, or alter their record.
2. **No automatic change to the app side.** We do not call `leaveProgram` on their behalf — that's a human decision.
3. **Alert.** `Sentry.captureException(new Error('buttondown.unsubscribed_member'), { extra: { profileId, email, currentPrograms, unsubscribedAt } })`. Captured as an exception (error level) so Sentry's project alert rules send an email notification to the dev team. Configure the alert rule once in the Sentry UI to fire on this fingerprint.
4. **Idempotency.** The alert fires once per cron run per unsubscribed member; that's acceptable noise (low cardinality, daily). If we want truly once-and-done semantics later, a `profiles.buttondownUnsubscribeAlertedAt` column is the natural next step.

Until a human resolves the case (typically by calling `leaveProgram` on each `buttondownTag`-bearing program, or by removing the IS Web membership entirely), the daily cron continues to skip the subscriber and re-fire the alert. That's by design — the unresolved state is itself a problem worth flagging.

## Concurrency lock

A lease-based table prevents two sync runs (cron + admin-triggered, or two adjacent daily crons in a long-running rare case) from racing.

```sql
CREATE TABLE sync_locks (
  name text PRIMARY KEY,
  locked_until timestamptz NOT NULL,
  acquired_by text NOT NULL  -- e.g. "cron:2026-05-22T08:00Z" or "admin:<profileId>"
);
```

Acquire pattern:

```sql
INSERT INTO sync_locks (name, locked_until, acquired_by)
VALUES ('buttondown', now() + interval '10 minutes', $1)
ON CONFLICT (name) DO UPDATE
  SET locked_until = excluded.locked_until,
      acquired_by  = excluded.acquired_by
  WHERE sync_locks.locked_until < now()
RETURNING 1;
```

Empty RETURNING means the lock is held by someone else and still valid. Release deletes the row: `DELETE FROM sync_locks WHERE name = 'buttondown' AND acquired_by = $1`. The table never grows past one row per actively held lock — it's empty whenever nothing is running. The `acquired_by` clause on release stops a stale lock holder from accidentally deleting a fresh one if it wakes up after its lease expired.

The 10-minute lease is well above expected run time (small audience, sub-minute API churn) and bounds the worst case where a process dies mid-run without releasing — the next run picks up after the lease expires.

Why not PostgreSQL session-level advisory locks: they're tied to a connection, and Supabase's transaction pooler doesn't preserve session identity across pool members (see `docs/strategy-db-transactions.md`). The lease table is pooler-safe and trivial to inspect.

## Logging

All sync events go through `next-axiom`'s structured logger, matching the request-logging pattern already in `src/server/api.ts:181`:

```ts
log.info("buttondown sync", { runId, action: "tag-added", profileId, tag });
```

The `message` string (`"buttondown sync"`) is the feature label — the same field-name role that `"api request"` already plays for HTTP logs. `fields.action` distinguishes event kinds within the feature (`summary`, `tag-added`, `subscriber-created`, `unsubscribe-alert`, `email-updated`). Axiom queries filter with `where message == "buttondown sync"`; sub-streams come from filtering on `fields.action`. One summary record per run, plus per-event records for noteworthy state transitions.

No new env vars, no additional SDK — next-axiom already streams to our Axiom dataset. No `console.log` in the sync; everything goes through `log.<level>` so events arrive in Axiom with consistent shape.

The top-level `source` field is reserved by next-axiom for the deployment runtime (`lambda-log`, `frontend-log`, etc.) — don't repurpose it.

## Prod-only by construction

Four independent locks. Any one keeps the integration off:

1. **Cron entry in `vercel.json`** — Vercel's scheduler fires only on the production deployment. Preview deployments host the same code but the scheduler doesn't invoke them.
2. **`BUTTONDOWN_API_KEY` set only in the Production env scope.** Code path detects missing key → no-op + Sentry breadcrumb (expected on dev/preview, not an error).
3. **`CRON_SECRET` bearer check** on the endpoint, so a public hit can't run it.
4. **`BUTTONDOWN_SYNC_WRITE=1` cron write toggle** — this *is* the dry-run mechanism, not a separate concept. The cron reads this env var to decide whether to pass `write: true` or `write: false` into the sync function. The actual gate lives one layer deeper, at the Buttondown API client: every mutation method (PATCH/POST/DELETE) short-circuits when called with `write: false`, regardless of trigger. With the env var unset (the default), the cron runs dry; set to `1` to go live and leave set after rollout. Admin-triggered runs (see [Endpoint shape](#endpoint-shape)) skip the env var and pass their `write` choice explicitly.

The inline-on-first-save path uses lock #2 only — no `BUTTONDOWN_API_KEY` in env means it no-ops in dev and preview.

## API version pinning

Buttondown ties each API key to a specific API version and only moves it when we ask. Concretely: `BUTTONDOWN_API_KEY` on production sees the same API surface until someone clicks "migrate to latest version" on that key in Buttondown's UI — drift is impossible by construction, and an upgrade is a deliberate ops action. The api-golds re-record (Appendix A) is part of that flow.

Optionally we can issue a *second* key on a newer version while keeping the original key in place — useful for A/B comparing behavior under the new version before committing to the migration. Not required; the default is a single in-place key migration when we decide to move forward.

## Schema changes

```ts
// add to programs table
buttondownTag: text("buttondown_tag"),

// add to profiles table
buttondownSubscriberId: text("buttondown_subscriber_id"),

// new table
export const syncLocks = pgTable("sync_locks", {
  name: text("name").primaryKey(),
  lockedUntil: timestamp("locked_until", { withTimezone: true }).notNull(),
  acquiredBy: text("acquired_by").notNull(),
});
```

All expand-step migrations (see `strategy-committing.md`): land the columns and the table ahead of the sync code so previews can run against the same prod DB without choking. No backfill is needed at the schema level — `buttondownTag` is set per-program via `/admin/programs`, `buttondownSubscriberId` is populated lazily by the sync as it encounters each subscriber, and `sync_locks` starts empty.

## Endpoint shape

```
GET /api/cron/buttondown-sync
Authorization: Bearer ${CRON_SECRET}

→ 200 { scanned: 47, created: 2, tagged: 5, untagged: 1, unsubscribe_alerts: 3, email_updates: 0, errors: [] }
```

Two parallel admin-triggered routes, both gated by admin auth instead of `CRON_SECRET`, surfaced as two buttons in `/admin`:

- **"Sync Buttondown (dry run)"** — fires immediately, no confirm step. Produces a fresh diff in the logs without any writes. Safe to press anytime, including after rollout when the cron is writing.
- **"Sync Buttondown (write)"** — opens a confirm step ("This will reconcile N member records against Buttondown. Continue?") and only writes on the confirm.

Both call the same internal function with `acquired_by = "admin:<profileId>"` on the lock and an explicit `write` flag (false for dry-run, true for write). The env var is not consulted on either admin path — the admin's button choice is the source of truth. During the rollout dry-run window, the write button is the admin's deliberate override; after rollout it's just a manual on-demand sync.

## Initial bootstrap reconciliation (completed and deleted 2026-05-25)

A one-shot script reconciled the app's CSV-imported memberships against Buttondown's authoritative pre-cutover tag state, calling `leaveProgram` where the two disagreed and writing nothing to Buttondown. Ran in `--write` mode against prod on 2026-05-25 — two app-side corrections, zero `programsToJoin` cases — and was removed in the same commit set. See git history at `scripts/buttondown-bootstrap.ts` and `src/server/buttondown-bootstrap.ts` for the implementation.

## Rollout sequence

1. **Land the schema** (`programs.buttondownTag`, `profiles.buttondownSubscriberId`, `sync_locks` table) via expand-step. Add the `buttondownTag` field to the `/admin/programs` edit UI but leave every program's value null.
2. **Land the sync code** with `BUTTONDOWN_SYNC_WRITE` unset in prod. Cron starts firing daily at 08:00 UTC and logs diffs (filterable in Axiom by `source: "buttondown-sync"`).
3. **Set `BUTTONDOWN_API_KEY` and `CRON_SECRET`** in the prod env scope only.
4. **Set `buttondownTag` on the relevant programs** (e.g., `weekly-web-updates` → the same string the Apps Script wrote) via `/admin/programs`. The dry-run cron now produces a realistic diff against real data.
5. **Verify the dry-run output** over one or two daily cycles in Axiom: numbers look plausible, the diff doesn't propose touching the non-member newsletter audience, no surprises.
6. **One-shot bootstrap reconciliation** *(completed and deleted 2026-05-25)*. See the dedicated section above.
7. **Set `BUTTONDOWN_SYNC_WRITE=1` and disable the Apps Script trigger** *(completed 2026-06-12)*. With the cron writing, the Apps Script is no longer needed and leaving it active risks tag races on edge cases. The Form was retired in the same step.
8. **Wire the inline first-profile-save hook** *(completed 2026-05-25 in PR #280)*. Lowest priority — purely latency. The cron covers correctness once step 7 lands.

## Future work

- **Custom unsubscribe links.** Route Buttondown's unsubscribe through our app so the unsubscribe page can offer "leave just this program" vs "leave the network entirely" affordances. Would replace the human-review loop in [Unsubscribe handling](#unsubscribe-handling) with a structured user action.
- **Once-and-done unsubscribe alerts.** Add `profiles.buttondownUnsubscribeAlertedAt` so the cron raises one Sentry alert per unsubscribed member rather than re-firing daily. Defer until the daily noise becomes annoying — at our scale, "one daily reminder per pending case" is also a useful nag.
- **Tag rename safety.** If an admin changes a program's `buttondownTag` from `foo` to `bar`, subscribers tagged `foo` become stranded — `foo` is no longer in the managed universe so the sweep can't see it. Either keep a tag-history table or document the operational rule "rename ≠ change in place; do it via add-new + retire-old."
- **Per-program ad-hoc emails from the app.** If we ever want to compose and send from `/admin`, the natural surface is `POST /v1/emails` to Buttondown segmented by the tag this design already maintains. The sync side is the foundation either way.

---

## Appendix A: Fake-vs-real comparison (recording from a dedicated newsletter)

The in-memory fake at `tests/functional/server/buttondown-fake.ts` reflects how we *believe* Buttondown behaves today. Two ways that belief can be wrong:

- **Wire shape drift.** Buttondown adds, renames, or retypes a response field; the new shape no longer matches our `ButtondownSubscriber` projection or the fake's synthesized responses.
- **Stateful behavior drift.** The fake's reaction to a sequence (create → PATCH → GET) diverges from real Buttondown's reaction to the same sequence — same wire shape, different transitions.

Both surface as `fake ≠ real`. Both are addressed the same way: record real responses to a dedicated test newsletter, then assert the fake matches when replayed.

### The setup

A dedicated newsletter on our Buttondown account — name: **`api-tests`**, username **`intentional-society-api-tests`** — holds a stable test audience. Buttondown keys are scoped to a single newsletter, so the test-newsletter key is **structurally incapable** of reaching real subscribers; that's enforced by Buttondown's API, not by our naming convention. Every test-related activity uses that key against that newsletter.

### Three dev-machine scripts (none run in CI)

The manual tests deliberately live outside the `npm test` portfolio. They're run manually when someone touches the fake or adopts a new API version, not on every PR. The npm scripts:

- **`npm run special:buttondown:seed-fixtures`** — idempotent reset of the test newsletter to a canonical "robust set of subscribers" defined by `seed.json` in the fixtures directory. Empties the newsletter, then creates each subscriber from the seed. Run once when first setting up the test newsletter; re-run whenever the live state has drifted from canonical (e.g., after probe runs that leave residue).
- **`npm run special:buttondown:record-api`** — runs the probe sequence (see below) against the real test newsletter, captures each response, and writes the gold files. Assumes the newsletter is already in seeded state — does not re-seed.
- **`npm run test:manual:buttondown-api-replay`** — runs the same probe sequence against the in-memory fake, asserts the normalized typed sequence deep-equals the normalized recorded golds. Needs no API key.

Record and seed both load `.env.prod` and require `BUTTONDOWN_TEST_API_KEY`. The primary safety is structural — Buttondown's per-newsletter key scoping confines writes (and `listSubscribers` reads) to the key's specific newsletter, so a mis-pasted key cannot reach the wrong audience. The operational sanity check is `assertTestNewsletter` in `tests/manual/_buttondown-probes.ts`: it calls `GET /v1/accounts/me`, which returns the single newsletter the key writes to, and refuses to proceed unless the username matches `intentional-society-api-tests`. That catches both wrong-account and wrong-newsletter-same-account swaps. The key needs `administrivia_access` to call `/accounts/me` (in addition to `subscriber_access` for the destructive ops); the seed-fixtures script's startup error message points at this if the permission is missing.

### One probe sequence

There's one ordered sequence of probes covering every public method on `ButtondownClient`, plus targeted error and edge cases. The authoritative list lives in code at `tests/manual/_buttondown-probes.ts` (`buildProbes()`); the recorded outcome for each probe lives at `tests/functional/server/__data__/buttondown/golds/NN-<short-name>.json`. Record and replay both walk the sequence in order.

The last probe deletes the created subscriber, so re-running the sequence is idempotent without needing to re-seed.

### Data layout

```
tests/functional/server/__data__/buttondown/
  fixtures/
    seed.json
  golds/
    meta.json
    01-list-seeded.json
    02-get-account.json
    ...
```

`fixtures/` holds synthetic inputs we author; `golds/` holds outputs recorded from the real Buttondown API.

- `fixtures/seed.json` — the canonical audience the seed script puts into the test newsletter. Plain data, not test logic.
- `golds/meta.json` — `{api_version, key_fingerprint, recorded_at, recorded_by}`. One stamp per record run.
- `golds/NN-<short-name>.json` — one file per probe step, sorted lexicographically by leading number. Each file holds `{probe, http_calls, typed_result}`. The `http_calls` array captures raw request/response bytes; `response.body` is omitted on 200 and 201 (the typed projection of that body is what `typed_result` already holds, so re-recording the raw bytes would just be noise) and kept on every other status so error shapes stay diagnosable. `typed_result` is what the replay test deep-equals against, after id-normalization runs identical transforms on both the fake's output and the recorded gold.

### Re-record workflow (yearly-ish)

Re-recording is rare and intentional — see [API version pinning](#api-version-pinning) for why drift is impossible without explicit action:

1. In Buttondown's UI, click "migrate to latest version" on the test-newsletter key (`BUTTONDOWN_TEST_API_KEY`). Optionally issue a second key on the new version and migrate that one while leaving the original alone, so old vs new can be A/B compared by swapping which key the script uses.
2. Run `npm run special:buttondown:seed-fixtures` if the live state has drifted.
3. Run `npm run special:buttondown:record-api`.
4. `git diff tests/functional/server/__data__/buttondown/golds/` shows what Buttondown changed.
5. If the diff is benign (only `meta.api_version` / `meta.recorded_at` move), commit.
6. If the diff is semantic, update the client and/or fake to match new behavior, then commit golds and code together.

The production cron's key is a different key on a different newsletter — it stays on its current API version until someone migrates it separately, which is the actual upgrade event.

### Implementation pieces

- `tests/functional/server/__data__/buttondown/fixtures/seed.json` — canonical audience.
- `tests/manual/_buttondown-probes.ts` — the probe sequence as ordered code, plus `assertTestNewsletter`.
- `tests/manual/buttondown-api-golds.test.ts` — Vitest test that drives the probe sequence against real Buttondown and writes the gold files. Skipped without `BUTTONDOWN_TEST_API_KEY`. Invoked by `npm run special:buttondown:record-api`.
- `tests/manual/buttondown-replay.test.ts` — Vitest replay runner against the fake. Lives under `tests/manual/` so the default vitest config excludes it from `npm test`; the `npm run test:manual:buttondown-api-replay` script invokes Vitest with this file as the explicit target.
- `scripts/buttondown-recording/seed-fixtures.ts` — implements `npm run special:buttondown:seed-fixtures`.
- `vitest.manual.config.ts` — separate Vitest config that scopes to `tests/manual/**/*.test.ts`; the two manual npm scripts above invoke Vitest with this config.

`key_fingerprint` in `meta.json` is **first 3 + last 3** characters of the key (e.g., `abc...xyz`). Enough to confirm "same key as last recording" without leaking the value.

### What this catches and what it doesn't

Catches:
- Field type changes in subscriber responses.
- New required fields on POST.
- Status-code changes on known cases.
- Multi-step state-transition divergences (create-then-read returns the same shape as real Buttondown's create-then-read).

Doesn't catch:
- Rate-limit shape changes (we don't exercise them).
- Behavior that only manifests at production scale.
- Buttondown features we don't yet call.
