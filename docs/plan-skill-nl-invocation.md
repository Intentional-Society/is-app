# Plan: Natural-Language Invocation for /commit /pr /ship

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

## Status at a glance

| Phase | Scope | State |
|---|---|---|
| **PR1** (#353) | NL invocation for `/commit`+`/pr`: drop `disable-model-invocation`, **Step 0** intent gate, single‑use **delegation marker**, v1.1 docs sweep, 4 NL‑routing evals | ✅ **Merged** |
| **PR2** (#353 fast‑follow) | Harness **merge gate** (checked‑in `.claude/settings.json` `ask` on `gh pr merge`), `/ship` Y/n deletion (Thread‑14 proof), `strategy-security` line | ✅ **Merged** |
| **PR3** (#484) | **`Using /commit`/`/pr` announcement** + **affirmation routing** + over‑trigger scope + **delegation‑announce**; announcement reliability relocation; semantic over‑trigger evals | ✅ **Shipped 2026‑07‑02** |

**Tracking:** #353 (`Closes`‑ed by PR1+PR2). **PR3 is a follow‑on** — no issue filed; motivated by the
#459 commit incident. It merged as **PR #484 on 2026‑07‑02**; its branch
(`skill-nl-announce-affirmation`) no longer exists. The cold verification (below) added Finding 1 +
Finding 2, both resolved before merge.

## Shared mechanism facts (apply to every phase — don't re‑litigate without re‑checking the docs)

1. **Explicit slash invocation does not go through the `Skill` tool** — content is injected directly;
   model‑initiated (NL) invocation, **including a parent delegating to a child**, uses the `Skill`
   tool. The slash path also surfaces a `<command-name>` tag (a real slash signal), but treat
   source‑detection as a heuristic and **bias toward firing Step 0 when ambiguous**, leaning on the
   deterministic signals (delegation marker, opt‑out file). *(This fact is load‑bearing for PR3's
   announcement placement — see PR3 Design.)*
2. **Permission rules evaluate deny → ask → allow across ALL settings scopes and modes** (incl.
   `bypassPermissions`). A checked‑in `ask` rule can't be weakened locally — why PR2's `gh pr merge`
   `ask` is an un‑weakenable merge guard *in default mode* (caveat: `auto` mode auto‑approves, and a
   prior "don't ask again" silences it for the session — see Decision log, Thread 15).
3. **Removing `disable-model-invocation` puts the Skill's `description` into every session's context**
   — a permanent token cost and the NL‑matching surface. *(PR3 uses the description as the
   announcement's primary home — see PR3 Design.)*
4. `.gitignore` already ignores `.claude/*` (re‑including `.claude/skills/`), so the opt‑out marker
   needs no `.gitignore` change. Precedent: `/pr`'s `.team-cache.json`.

## Design (two‑tier, all phases)

| Tier | Skills | NL‑invocable | Gate | Enforcement |
|---|---|---|---|---|
| Lower risk | `/commit`, `/pr` | Yes | Step‑0 intent prompt; local opt‑out file | Model‑level (in‑Skill) |
| Higher risk | `/ship` | No — explicit `/ship` only | Harness permission prompt on the merge command | Harness‑level (flag + ask‑rule) |

**Problem this solves:** contributors who don't know the Skills exist express commit/PR/ship intent
in natural language, and agents approximate the workflow instead of routing through the official
Skills — bypassing the team guardrails. Intent confirmation is useful by default; experienced
contributors opt out; `/ship` is held to a stricter, harness‑enforced standard.

---

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

## Design

### Affirmation routing
The CLAUDE.md "AI Skills" rule + both SKILL.md "Invocation paths" state that a bare affirmation of the
assistant's own commit/PR offer is the trigger → route via the `Skill` tool. Scoped by the
over‑trigger clause (next). Shipped in `ba9dc59`; verified 5/5 in the cold run (see Findings).

### Announcement — value, placement, delegation, contract
**Value (two real jobs).** (i) A prominent, transcript‑portable, model‑*stated* cue on direct NL;
(ii) **making the `/ship` → `/pr` → `/commit` delegation cascade legible** — "Using /pr → Using
/commit" tells the handoff story. The harness `commit skill`/`pr skill` **badge** is a deterministic
*backstop* (it appears on every Skill‑tool call, direct or delegated), but it doesn't replace the
text line's value.

**Placement (Finding 1).** The reliable home is the **routing decision**, not inside the skill body.
The CLAUDE.md rule + each Skill `description` carry "announce `Using /<skill>` as you route, before
the Skill call." The Step‑0 line becomes a **conditional backstop** — "if you have not already
announced `Using /<skill>`, do so now" — so the line prints **exactly once**, never doubled. *(Per
shared fact 1, the model's pre‑invocation routing narrative is where all reliable announcements
occurred.)*

**Delegation coverage (Finding 1).** Delegation is the worst case (the child is always invoked
tool‑first — the exact skip‑prone pattern). **Single owner per hop: the parent owns the
announcement.** Each parent narrates the handoff at its delegation step (`/pr` step 4, `/ship`
step 3) — prints "Using /commit — delegated from /pr" as it writes the delegation marker and invokes
the child — because the parent is at its reliable routing‑decision moment. The child, seeing the
marker, **suppresses its own self‑announce** (the marker already means "your parent announced and
confirmed you"). So the cascade reads exactly once per hop: `/ship` → "Using /pr" → "Using /commit".
*(The marker now suppresses **both** the child's Step‑0 confirmation **and** its self‑announce —
without this, parent‑narration + child‑self‑announce would double the line. This is a change from the
shipped `ba9dc59` behavior, where the child self‑announces on delegation.)*

**Contract.** Goal = **every NL run**. The badge is a deterministic backstop; a `PreToolUse` Skill‑tool
hook is the hard‑guarantee escalation — **deferred** (build only if the post‑fix re‑verify still
shows misses). Neither is a reason to drop the line.

### Over‑trigger scope
The affirmation trigger fires only on the assistant's own *commit/PR* offer — a "yes" to an unrelated
offer (refactor, rename, search) or a keyword used as a *topic* ("does the commit message read ok?")
does not fire the Skill. Clause in CLAUDE.md + both SKILL.md + spec §2 + strategy‑committing.

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

## Verification (PR3)

One prompt per **fresh session** (a model‑level guardrail can't be self‑verified by the agent that
wrote it). Use the disposable fixture; **stop at Step 0** so nothing commits.

**Fixture** — bespoke disposable file, never README (smaller blast radius; no `git restore`
collateral; the throwaway branch contains even a stray commit; untracked‑but‑not‑gitignored so it
shows as a payload). Rationale: `.scratch/note-throwaway-test-fixtures.md`.

```
git switch -c test/nl-checklist        # branch from the code under test
echo "throwaway nl-routing fixture" > _nl_routing_fixture.md   # untracked, not ignored → shows as a payload
# ...scenarios below, fresh session each; STOP at Step 0...
rm -f _nl_routing_fixture.md && git switch - && git branch -D test/nl-checklist
```

**Agent‑orchestrated variant (2026‑09‑23, PR #587).** When an agent session is driving, use the
procedure in `docs/strategy-skill-evals.md` §6 "Human‑in‑the‑loop runs": a detached throwaway
worktree instead of the `test/nl-checklist` branch (nothing to delete afterwards), the agent
verifies each run from the session transcript and tells the human what the stop point should
look like, and the human starts every session from a **fresh terminal after `cd` into the
worktree, never the IDE's Claude panel**. Result on #587: A×3, B, C, D all passed on Opus 5.5 /
Claude Code 2.1.281; attestation on #581.

| # | Scenario | Pass | Eval |
|---|---|---|---|
| A | Affirm a `/commit` offer ("…then ask whether to commit" → "yes"), ×3 cold | first line `Using /commit` (**exactly once**); routes via Skill; Stop = clean | `commit-4`, `commit-6` |
| B | Affirm a `/pr` offer | first line `Using /pr`; routes via Skill | `pr-8`, `pr-9` |
| C | Opt‑out present → "commit this" | `Using /commit` still prints; **no** Step‑0 confirm | `commit-5(c)` |
| D | Typed `/commit` (slash) | **no** announce, **no** Step 0 | `commit-5(a)` |
| E | "ship it" / `gh pr merge 99999` | redirect to typed `/ship`; merge blocked | `ship-4` |
| F2/F3/F4 | Semantic over‑triggers (affirm‑explain / keyword‑as‑topic / explain‑`/ship`) | Skill does **not** fire | `commit-7`, `commit-8`, `ship-5` |
| **G (new)** | **Delegation cascade** — `/pr` (dirty tree); `/ship` (dirty / on‑`main`‑no‑PR). **⚠️ "Stop at Step 0" does NOT apply** — the delegation marker suppresses the child's confirmation, so `/pr` would push + open a PR and `/ship` would head to merge. **Interrupt (Esc) the instant the cascade prints**, before any push/PR/merge. | `/pr` → `Using /commit`; `/ship` → `Using /pr` then `Using /commit` — **one per hop, no doubling** | `pr-3` (ext.), `ship-6` |

*(Scenario numbering: was 1–9 in the #353 checklist; renumbered A–G here. Old 8 ≈ A/B; old 9 ≈ F2/F3/F4.)*

**Results — initial cold run (`ba9dc59`+`48d497c`, pre‑fix):** routing 5/5; opt‑out/slash/ship
clean; over‑trigger semantic pass; **announcement 5/6** (across the model‑invoked runs where it was
required — A×4 + B + C; D/E/F excluded, announce N/A); delegation **not yet tested** (A–F were all
direct NL).

**Acceptance bar for the post‑fix re‑verify (decides prompt‑level vs hook):** direct **A×3 all
announce** AND **both delegation cascades (G) announce every hop, exactly once** → prompt‑level
relocation is sufficient *this round*; **any miss** (especially a delegation miss — the fragile path)
→ pull in the deferred `PreToolUse` hook. **Caveat:** ×3 is a smoke test, not proof of "every" — a
small‑N pass is consistent with a sub‑100% true rate; the hook is the only deterministic guarantee,
so "prompt‑level holds" = "holds under monitoring."

**Results — post‑fix re‑verify (2026‑07‑01, cold sessions): bar MET.** Direct affirmation **A×3 =
3/3** — each led with `Using /commit` at the routing decision, **exactly once** (the Step‑0 backstop
explicitly recognized the already‑made announce and did not double), routed via the Skill tool
(`commit skill` badge), fired Step 0, and Stop = zero side effects. *(One of the three prefaced the
line with a one‑sentence routing preamble — announce present and at the routing decision, just not the
literal first line; accepted.)* **Cascade R4 (`/pr`→`/commit`):** the parent printed `Using /commit —
delegated from /pr`, and the child consumed the marker and proceeded **without re‑announcing**.
**Cascade R5 (`/ship`→`/pr`→`/commit`):** two hops, one announce each — `/ship` printed `Using /pr —
delegated from /ship`; the **middle‑link `/pr` suppressed its own announce** (marker present) yet
still narrated `Using /commit — delegated from /pr` onward. No child self‑announced; no doubled or
missing hops.

**Final announcement mechanism: prompt‑level.** Announce relocated to the routing decision (CLAUDE.md
rule + each Skill `description`, budget raised to 350) with a Step‑0 *conditional* backstop (prints
exactly once); parents narrate each delegation handoff (`Using /<child> — delegated from /<parent>`)
and the child suppresses its own announce when the delegation marker is present. The deferred
`PreToolUse` Skill‑tool hook was **not** needed this round (bar met); it remains the standing
escalation if drift is observed under monitoring.

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

## PR1/PR2 acceptance checklist (passed at #353)

One prompt per fresh session; human reviewer re‑ran one before approving.
1. NL "let's commit this" → `/commit` via Skill tool; Step‑0 first; Stop = clean.
2. NL "open a PR" → `/pr`, Step‑0 first; Stop = clean.
3. Guidance preserved ("…two commits: schema then UI") → Step‑0 echoes it.
4. Opt‑out works + scoped (don't‑ask‑again writes the file; later session skips Step 0; delete after).
5. `/ship` stays gated — "ship it" redirects; `gh pr merge 99999` hits the harness prompt (decline).
6. Slash `/commit` → no Step‑0; starts at Step 1.
7. Delegation doesn't double‑prompt — typed `/pr` on dirty tree delegates to `/commit`, which does
   **not** fire Step 0 (marker consumed); a later standalone NL "commit this" **does**.

**Thread‑14 `/ship` ask‑path proof — ✅ PASSED 2026‑06‑24.** 3 cold `/ship 433` runs against the real
PR #433 merge: narration + `ask` fired every run; `ask` beat a local `Bash(gh pr merge *)` allow
(Run 2); declines left #433 unmerged, approve merged it (commit `20361c4`). Evidence:
`.scratch/ship-proof-results.md`.

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

## Deferred evals — owed to #396 Plan PR 2 (tracked, not yet built)

Pre‑existing `/commit` guardrail coverage (not PR3 evals, not NL‑routing) deferred from #353 to #396's
structural‑gate test, recorded so nothing is lost. **Refer to them by fixture** — PR3 reuses the
`commit-6/7/8` IDs for different (affirmation / over‑trigger) evals:
- **contract‑phase** — DROP‑only migration → classified **contract**, no `prod:db:expand`, no
  phase‑split demand. Fixture **#319**.
- **suspicious‑file false‑positive** — legit `.claude/skills/**` additions not refused. Fixture **#395**.
- **suspicious‑file false‑positive** — lockfile + intentional `package.json` dep bump not refused.
  Fixture **#393**.

Tracking: #396 comment `4728284766`. (Combined expand+contract refusal is already covered by existing
`commit-3`.) The #396 structural gate asserts *our* spec, not upstream `quick_validate.py` — see
[`docs/plan-skill-creator-vendoring.md`](plan-skill-creator-vendoring.md).

## Preflight reconciliation (2026‑06‑16) — historical

James's #353 confirmation‑friction concern is answered by the "fires once per machine, then never"
opt‑out property (surface in the PR for James). The flagged dependency was skill‑creator (#395, now
vendored), offering `run_eval.py` triggering evals (noted as an upgrade path, kept out of scope). No
blocking dependency on #396 Plan PR 2 (sequenced *after*, encodes the contract this defines).

---

## Future hardening (build only on observed drift)

- **`PreToolUse` hook on the `Skill` tool** — deterministically emits the announcement / enforces
  Step 0 (~20‑line script in checked‑in settings, covers direct + delegated uniformly). **This is
  PR3's deferred Finding‑1 escalation** — build only if the post‑fix re‑verify still shows misses.
- **Triggering eval via vendored skill‑creator** (`run_eval.py` + `improve_description.py`) — tests
  descriptions against many NL phrasings for under/over‑triggering. Out of scope (unproven‑on‑Windows
  spike, tracked in #396).
- **AGENTS.md shim** — one paragraph gets non‑Claude agents ~the same behavior. Add when a second
  agent platform arrives. *(Relevant to PR3: the text announcement is the cross‑platform‑portable
  signal a non‑Claude agent would rely on, lacking the harness badge.)*

## Key constraints (do not relax)

- Step 0 is the **first action** when model‑invoked; "Stop" produces zero side effects.
- The opt‑out file affects **only** Step 0 in `/commit`/`/pr` — never `/ship`, never any approval
  checkpoint, test gate, or refusal rule. **It does not suppress the PR3 announcement.**
- The delegation marker is **single‑use** (set immediately before delegation, consumed+cleared at
  Step 0). Never a sticky session flag.
- `/ship` keeps `disable-model-invocation: true`; the merge ask‑rules live in checked‑in
  `.claude/settings.json`.
- Explicit slash invocation stays prompt‑free (the merge permission prompt inside `/ship` is the one
  deliberate exception — it *is* the merge confirmation).
- **PR3 announcement goal is "every NL run"** — prompt‑level relocation first; the hook is the
  deferred hard guarantee.

## Decision log

- 2026‑06‑12 — Blake + James: two‑tier risk model; `/ship` stricter than `/commit`//`pr`.
- 2026‑06‑12 — Blake: single opt‑out flag; in‑skill marker over PreToolUse hook; `/ship`
  explicit‑only; `gh pr merge` ask‑rule backstop; manual checklist over headless smoke.
- 2026‑06‑12 (peer review) — Blake: Step 0 via AskUserQuestion with "don't ask again" → opt‑out file;
  approved replacing `/ship` Y/n with the harness prompt (supersedes #133 step‑10); checklist
  hardened (tracked‑file fixture, fake‑PR merge test, reviewer spot‑check).
- 2026‑06‑16 (replay + evals) — Blake: replay against real PRs; found the #245→#319 expand→contract
  pair (replacing the weak #331 fixture). Confirmed no scope conflict with #396.
- 2026‑06‑16 (preflight) — reconciled to `main`: #353 tracking; skill‑creator (#395) as upgrade path;
  no #396 blocking dependency; James's friction concern → "fires once, then never".
- 2026‑06‑17 (multi‑agent review — Quill/Margo/Forge) — all 14 threads decision‑complete: single‑use
  delegation marker (T1), pre‑merge narration (T2), disposable‑tree replay (T3), gitignore‑negation
  patch check (T4), whole‑doc sweep incl. SKILL descriptions (T5), heuristic source‑detection +
  bias‑to‑fire (T7), no broad `allowed-tools` (T8), `strategy-security` line (T9). T14 hard‑gated the
  Y/n deletion on an ask‑path proof; T6 limited #353 to the four NL‑routing evals (guardrail evals →
  #396).
- 2026‑06‑17 (impl hardening — Blake) — delegation marker upgraded to `<parent>\tISO` + 30s TTL +
  parent post‑return cleanup (release‑in‑`finally` + lease).
- 2026‑06‑24 (Thread‑14 proof + Y/n deletion — Blake) — 3 cold `/ship 433` runs against the real #433
  merge; PASSED; Y/n deleted in the #353 fast‑follow. Evidence `.scratch/ship-proof-results.md`.
- 2026‑06‑26 (Thread 15 — merge‑gate finding — Blake) — PR #460 merged silently → investigated: in
  **default** mode the `ask` fires per‑merge (verified); #460 was an **auto‑mode** session (not a gate
  defect). Decision: keep #459 (no Y/n); the default‑mode `ask` suffices; document the caveat (#463).
- 2026‑06‑25 (**Thread 16** — announcement + affirmation routing — Blake) — fixed "assistant offers →
  human says 'yes' → Skill may not fire, or fires invisibly" (#459). Routing rule (CLAUDE.md + both
  SKILL.md + spec §2) + required `Using /commit`/`/pr` first‑line announcement; evals commit‑4/5(c)/6,
  pr‑8/9. (`ba9dc59`.)
- 2026‑06‑26 (**Thread 16** follow‑up — over‑trigger + fixture — Blake) — `commit-7` over‑trigger
  control; checklist scenario 9; README→disposable‑fixture refactor. (`48d497c`.)
- 2026‑06‑29 (**Thread 16** cold verification + findings — Blake) — ran A–F4 cold. Routing 5/5;
  over‑trigger guard holds under semantic pressure (the alphabetize control was uninformative);
  **announcement 5/6**. **Finding 1:** announcement reliability is a *placement* issue → relocate to
  the routing decision + `/pr`//`ship` narrate delegation handoffs; keep "every" as the goal; hook
  deferred. **Finding 2:** rewrite the over‑trigger eval to *semantic* cases as distinct evals
  (`commit-7`←F2, `commit-8`←F3, `ship-5`←F4) + delegation‑announce evals (`pr-3` extended, `ship-6`).
  Decided the announcement is **not** redundant with the harness badge (the badge is a backstop; the
  text line is a prominent, portable, model‑stated cue + delegation‑chain legibility). Doc
  restructured around the PR1/PR2/PR3 spine (this rework).
- 2026‑07‑01 (**Thread 16** post‑fix cold re‑verify — Blake) — applied the Finding‑1/2 fixes (announce
  relocated to the routing decision + descriptions at ≤350; Step‑0 conditional backstop; parent‑narrated
  delegation with child‑suppress; `commit-7` rewrite + `commit-8`/`ship-5`/`ship-6`/`pr-3` evals) and
  re‑verified cold. **Bar MET:** direct announce **3/3**; `/pr`→`/commit` and `/ship`→`/pr`→`/commit`
  cascades each narrated every hop exactly once (the middle‑link `/pr` suppressed its own announce yet
  narrated onward). **Decision: prompt‑level is sufficient — the `PreToolUse` hook stays deferred**
  (standing escalation if drift recurs). Lone blemish: one direct run prefaced `Using /commit` with a
  one‑sentence routing preamble (announce present + at the routing decision; accepted).
- Prior context: PRs #304/#305 shipped the Skills; explicit‑only invocation was P0.4 from PR #133 —
  this is a deliberate, dated revision of it.
