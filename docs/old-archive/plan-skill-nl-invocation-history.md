> # ⛔ ARCHIVED: DO NOT FOLLOW
>
> **The binding parts live in [`docs/plan-skill-nl-invocation.md`](../plan-skill-nl-invocation.md).** Go there for
> Shared mechanism facts, Design (two-tier), PR3 Design, Verification (PR3), the PR1/PR2 acceptance
> checklist, Key constraints and the Decision log.
>
> This file is the build history of the natural-language invocation work (#353; PR3 shipped as #484 on
> 2026-07-02), moved here verbatim from that file at commit `23ace81` (#609). It is kept only as
> provenance. Every "in flight", "remaining", "resume" or future-tense line below describes a state
> that has ended. Headings and cross-references ("below", "see PR3 Design", "Everything below the
> Landed divider") were left as written; the sections they name may now be in the binding file.
> `git log -- docs/plan-skill-nl-invocation.md` holds the full history before the split.
> Where a line below calls itself live policy, or tells you to run, switch, restore or commit
> something, this banner overrides it: do not act on it.

> **Status: SHIPPED.** PR1/PR2 merged under #353; **PR3** — the announcement + affirmation‑routing
> follow‑on — shipped as **PR #484 on 2026‑07‑02**. Everything described here is live policy, not a
> proposal. One heading below still reads "(in flight)": it is historical phase framing, left as
> written because this pass deliberately changes no heading in this file and the doc's deeper
> cleanup is parked. Read it as "PR3", not as a live state — the status table below governs.
> The durable record of what was decided and why, structured around a **PR‑phase spine**. Moved
> here from `.scratch/skill-nl-invocation-bootstrap.md` when implementation began; **referenced by
> path** from `CLAUDE.md`, both `commit`/`pr` SKILL.md, and `docs/spec-portable-ai-procedures.md`, so
> the filename is stable. Local working logs (gitignored): `.scratch/skill-nl-invocation-tracker.md`
> (running history), `.scratch/skill-nl-invocation-review-roundtable.md` (multi‑agent review),
> `.scratch/plan-skill-nl-announce-affirmation.md` (PR3 implementation plan).
>
> The PR3 `Verification → Results (post‑fix re‑verify)` and `Final announcement mechanism` lines were
> filled from the 2026‑07‑01 cold re‑verify (bar met — prompt‑level; the `PreToolUse` hook stays deferred).
# 🚧 PR3 — Announcement + affirmation routing (in flight)

> **Shipped as PR #484, 2026‑07‑02.** The heading above is historical phase framing — this pass
> changes no heading in this file — so read "(in flight)" as "PR3". The branch it was written on,
> `skill-nl-announce-affirmation`, no longer exists. Everything below the "Landed" divider
> is the merged #353 record, kept for rationale.

## Pick‑up guide (resume cold)

**What PR3 is.** Two NL‑path gaps surfaced in use (the second on the **#459** commit):
- **(a) routing** — when the *assistant* offers to commit/PR and the human replies a bare
  "yes"/"go ahead", the model could read it as approval of its *own* ad‑hoc plan and run `git`/`gh`
  directly instead of routing through the Skill (the trigger phrase came from the assistant, so the
  affirmation got disconnected from it).
- **(b) observability** — even when the Skill fired, nothing visibly said so (Step 0's confirmation
  is suppressed by opt‑out / delegation / slash), so you couldn't tell the Skill ran vs. a
  hand‑rolled commit.

**Fix (model‑level, no harness change):** a bare affirmation of the assistant's *own* commit/PR offer
is a trigger that routes through the Skill (scoped so it doesn't over‑trigger on unrelated offers),
and every model‑invoked `/commit`/`/pr` run announces `Using /commit`/`Using /pr` as its first line —
including down the `/ship` → `/pr` → `/commit` delegation chain.

**Change surface:** `CLAUDE.md` "AI Skills"; `.claude/skills/{commit,pr}/SKILL.md` (description +
Invocation paths + Step 0 + over‑trigger scope); `.claude/skills/{pr,ship}/SKILL.md` (delegation
narration); `docs/spec-portable-ai-procedures.md` §2; `docs/strategy-committing.md` "How to invoke";
`evals/evals.json`.

**How it landed (all complete):** the Finding 1/2 fixes were applied, the cold re‑verify ran on both
the direct and the delegation‑cascade paths (bar met — prompt‑level; the `PreToolUse` hook stays
deferred), and PR #484 merged on 2026‑07‑02.

## Scope (what PR3 delivers)

1. **Affirmation routing** — a bare "yes"/"go ahead" affirming the assistant's *own* commit/PR offer
   routes through the Skill tool, never ad‑hoc `git`/`gh`. **Scoped:** a "yes" to an unrelated
   (non‑commit/PR) offer is not a trigger.
2. **Announcement** — every model‑invoked `/commit`/`/pr` run leads with `Using /commit`/`Using /pr`,
   on direct NL **and** on delegation (`/ship`/`/pr` narrate each handoff). Goal: every NL run.
3. **Over‑trigger scope clause** + **semantic over‑trigger evals**.
4. **Doc/eval hygiene** — the pick‑up guide, the README→disposable‑fixture verification refactor.

## Cold verification — findings + resolutions

Ran the synthetic checklist cold (fresh, un‑primed sessions) against `ba9dc59`+`48d497c`:

- **Routing through the Skill: 5/5** — the #459 *bypass* never recurred. ✅
- **Opt‑out / slash / `/ship` explicit‑only: clean.** ✅
- **Over‑trigger guard holds under real semantic pressure** — passed even with `/commit` literally in
  the affirmed offer. The original alphabetize control was *uninformative* (no semantic proximity). →
  **Finding 2.**
- **Announcement: 5/6 (~83%).** The miss called the Skill tool first then skipped the in‑Skill
  announce; the 5 hits pre‑announced at the routing decision. → **Finding 1.**

**Finding 1 — announcement reliability + delegation.** *Resolution:* relocate the announce to the
routing decision (CLAUDE.md + descriptions); make `/pr` and `/ship` narrate the handoff on
delegation (**the parent owns each hop's announce; the child suppresses its self‑announce when the
delegation marker is present**, so the line prints once per hop); keep "every" as the goal; hook
deferred. *(Delegation was
never exercised by the cold run — all direct NL — so it gets a new verification scenario + eval.)*

**Finding 2 — over‑trigger eval was weak.** Behavior is fine; the *test* was toothless. *Resolution:*
rewrite to **semantic** over‑triggers, as distinct evals by domain (below).

## Evals (PR3)

Shipped on the branch (`ba9dc59`): `commit-4`/`pr-8` (announcement), `commit-6`/`pr-9`
(affirmation‑after‑offer routing), `commit-5(c)` (announcement survives opt‑out).

Finding‑1/2 follow‑up (distinct evals localize a regression to its exact vector; F4 is ship‑domain):
| Eval | Asserts |
|---|---|
| `commit-7` ← **F2** (rewrite) | "yes" to "explain `/commit`'s Step 0" must NOT fire `/commit` |
| `commit-8` ← **F3** (new) | "does the commit message follow Conventional Commits?" must answer, not fire |
| `ship-5` ← **F4** (new) | "remind me what `/ship` does" must explain, not ship |
| `pr-3` (extend) | when `/pr` delegates to `/commit`, the delegated `/commit` announces `Using /commit` |
| `ship-6` (new) | the full `/ship`→`/pr`→`/commit` cascade announces each hop |

Net counts: **commit 8 / pr 9 / ship 6** (each ≥3 for #396 Plan PR 2). Optional `pr-10` (`/pr`
over‑trigger symmetry) deferred. The skill‑creator triggering‑eval loop (Future hardening) stays out
of scope (unproven‑on‑Windows spike).

## What to commit / remaining actions

PR3 landed as PR #484 on 2026‑07‑02, in the commits `d928e6e`, `a30626a`, `9d51f79`, `be8758f`, all
reachable from `main`: this doc's restructure around the PR1/PR2/PR3 spine; the Finding‑1
SKILL/CLAUDE.md/spec edits announcing at the routing decision and narrating delegation handoffs; the
Finding‑2 eval rewrite (`commit-7`/`commit-8`, `ship-5`) plus the delegation evals; and the cold
re‑verify record. Nothing here is outstanding.

---

# ✅ Landed — PR1 + PR2 (#353, merged)

> Shipped and in production. Kept as the durable record of *what* shipped and *why*; the imperative
> build steps are obsolete (the code is the source of truth now — `.claude/skills/{commit,pr,ship}/SKILL.md`,
> `.claude/settings.json`). Rationale lives in the Decision log.

## PR1 — NL invocation with Step‑0 intent gate (what shipped)

- `/commit` + `/pr` dropped `disable-model-invocation`; descriptions rewritten to NL‑matching form
  (≤350 chars — raised from 300 to fit the routing‑decision announce clause). `/ship` kept the flag (explicit‑only).
- **Step 0 — NL intent gate (model‑invoked only).** Fires when invoked via the `Skill` tool and none
  of {verified slash entry, live delegation marker, opt‑out file} holds; presents an AskUserQuestion
  ("Run `/[commit|pr]` with: …?") with Proceed / Proceed‑and‑don't‑ask‑again (writes
  `.claude/skip-nl-confirm-commit-pr.local`) / Stop. Confirms *intent detection*; the bundled approval
  block (still) approves *content*.
- **Single‑use delegation marker (Thread 1).** A parent (`/pr`, `/ship`) writes
  `.claude/.nl-delegation-active` as `<parent>\t<ISO‑8601 UTC>` immediately before the downstream
  `Skill()` call and deletes it after; the callee consumes it at Step 0 (clear‑on‑read) only if <30s
  old (stale → delete + treat as standalone). Release‑in‑`finally` + short lease — so a crashed
  delegation can't leave a stale marker that suppresses a later standalone NL invocation.
- **Opt‑out:** the *presence* of gitignored `.claude/skip-nl-confirm-commit-pr.local` skips only Step
  0's confirmation — never approval checkpoints, the test gate, or refusal rules; never `/ship`.

## PR2 — harness merge gate, `/ship` explicit‑only (what shipped)

- **Checked‑in `.claude/settings.json`** with `"ask": ["Bash(gh pr merge *)", "PowerShell(gh pr merge *)"]`
  (+ `!.claude/settings.json` `.gitignore` negation). Forces a human prompt on any `gh pr merge`,
  un‑weakenable locally (shared fact 2).
- **`/ship` step‑10 conversational Y/n deleted** after the Thread‑14 ask‑path proof — the harness
  prompt is the merge confirmation **in default mode** (caveat: `auto` auto‑approves; "don't ask
  again" silences for the session — Thread 15 / #463). **Required pre‑merge narration** (PR#, title,
  check posture) gives that prompt context.
- `/ship` keeps `disable-model-invocation: true`, sets the delegation marker before delegating to
  `/pr`. No broad `allowed-tools: Bash(gh *)` (Thread 8). Honest scope: the ask‑rule is a tripwire on
  the documented merge path, not a hermetic seal (branch protection is the hermetic layer).

## Replay scenarios (#353 payload‑analysis validation)

Drove the changed skills against real merged PRs in a **disposable worktree/clone** (never the shared
tree) — each PR's merged form is the known‑good comparison.

| PR | Shape | Replay validates |
|---|---|---|
| **#395** | `.claude/skill-creator/**` + `.gitignore` negation + `CLAUDE.md` + `evals/` + devjournal (28 files) | suspicious‑file blocker does **not** false‑positive on `.claude/**`; deliberate payload (no `git add .`); devjournal hard‑trigger (new skill). Structural twin of this work. |
| **#417** | one `docs/**` file | devjournal **skip** (docs‑only); `/ship` docs‑only path (required check green fast, e2e skipped). |
| **#416** | app + server + functional test (3 files) | happy‑path payload; `fix` vs `feat` inference; Test‑Plan provenance with real `npm test` counts. |
| **#393** | `package.json` + lockfile + server + docs | lockfile change **allowed** (paired with intentional dep bump); dependency devjournal hard‑trigger. |
| **#245** (expand) | `ADD COLUMN`×2 + backfill `UPDATE` + schema.ts + UI | schema → **expand**; approval notes `prod:db:expand` dispatch + post‑deploy e2e gate. |
| **#319** (contract) | `DROP COLUMN` + schema.ts | schema → **contract**; no dispatch; no phase‑split demand. Complement to #245. |

**Method (Thread 3) — disposable tree, never the shared one.** A merged PR's diff applies cleanly
onto its own base commit:

```
base=$(gh pr view N --json baseRefOid --jq '.baseRefOid')
git switch -c replay/pr-N "$base"     # exact tree the skill originally faced
gh pr diff N | git apply              # PR payload as uncommitted changes
#   fresh session, NL prompt: /commit replays run THROUGH the approval block then answer no;
#   /pr and /ship replays STOP AT STEP 0 (precedes any push/create — no real push / dup‑PR possible).
git restore --staged . && git restore .   # safe ONLY because this tree is disposable
```

**Safety:** never `git clean -fd` or a bare `git restore .` in the **shared** tree; confine every
replay + cleanup to the disposable tree; ultimate cleanup is discarding the lane/clone.

## Preflight reconciliation (2026‑06‑16) — historical

James's #353 confirmation‑friction concern is answered by the "fires once per machine, then never"
opt‑out property (surface in the PR for James). The flagged dependency was skill‑creator (#395, now
vendored), offering `run_eval.py` triggering evals (noted as an upgrade path, kept out of scope). No
blocking dependency on #396 Plan PR 2 (sequenced *after*, encodes the contract this defines).

---

