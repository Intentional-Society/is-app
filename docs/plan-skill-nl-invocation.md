# Plan: Natural-Language Invocation for /commit /pr /ship

> Moved here from `.scratch/skill-nl-invocation-bootstrap.md` (gitignored working memory) when
> implementation began on branch `353-skill-nl-invocation`. The multi-agent review log cited below
> as `.scratch/skill-nl-invocation-review-roundtable.md` is gitignored local working memory, not a
> committed artifact; this plan is the durable record of what was decided and why.

**Status:** Decided 2026-06-12 (Blake, after discussion with James); revised same day after peer
review; preflight-reconciled 2026-06-16; **multi-agent review (Quill + Margo + Forge) reconciled
2026-06-17 — all 14 threads decision-complete; only Thread 14 (`/ship` ask-path proof) is
execution-gated and resolves inside the implementation PR.** **Thread 14 RESOLVED 2026-06-24:** the
ask-path proof passed against the real PR #433 merge (3 cold `/ship 433` runs); the `/ship` step-10
Y/n was deleted in the #353 fast-follow (see §2 + Decision log). Supersedes the earlier bootstrap draft
(which removed `disable-model-invocation: true` from all three Skills uniformly). **Implemented in
this PR** (#353): `/commit` + `/pr` Step 0 + delegation marker, `/ship` ask-gate + required
pre-merge narration (Y/n retained additively in #353; deleted in the #353 fast-follow after the Thread-14 proof passed 2026-06-24 — see §2 + Decision log), docs v1.1 sweep, and the
four NL-routing evals. Review record: `.scratch/skill-nl-invocation-review-roundtable.md`.

> **⚠️ Update 2026-06-26 (Thread 15 — RESOLVED).** The "Thread-14 proof passed → Y/n deleted → harness `ask` is the sole/durable confirmation" framing here is **incomplete**: that proof ran one merge per fresh session and never tested a **2nd same-session merge**. A later silent merge (PR #460) triggered a re-test (Thread 15): in **default** mode the `ask` **does** fire per-merge (verified 2026-06-26), but `auto` mode auto-approves it and "don't ask again" silences it for the session — **#460 was an auto-mode session, not a gate defect.** **Decision (Blake): keep #459 (no Y/n); the default-mode `ask` is sufficient for normal use; document the caveat.** So the `ask` is the confirmation **under default mode**, not an absolute gate. Full record: **#463** (with the precise Y/n-restore recipe) and `.scratch/skill-nl-invocation-review-roundtable.md` Thread 15.

> **⚠️ Update 2026-06-25 (Thread 16 — announcement + affirmation routing).** Two natural-language-path gaps surfaced in use (the latter observed on the #459 commit): **(a) routing** — when the *assistant* offers to commit/PR and the human replies a bare "yes"/"go ahead", the model can read it as approval of its *own* ad-hoc plan and run `git`/`gh` directly instead of routing through the Skill; the trigger phrase came from the assistant, not the human, so the affirmation gets disconnected from it. **(b) observability** — even when the Skill does fire, nothing visibly says so (Step 0's confirmation is suppressed by the opt-out file, by delegation, and on the slash path), so the human can't tell the Skill ran vs. a hand-rolled commit. **Fix (model-level, same tier as the existing gates — no harness change):** the routing rule now explicitly covers "assistant offered → human affirmed" (CLAUDE.md + both SKILL.md "Invocation paths" + spec §2 constraint), and every model-invoked `/commit` / `/pr` run must announce `Using /commit` / `Using /pr` as its **first line** — **unconditional on the NL path, not silenced by the opt-out file or the delegation marker** (those suppress only Step 0's *confirmation*). The announcement doubles as a forcing function: an ad-hoc commit can't honestly print it. Evals: commit-4/pr-8 now assert the announcement; commit-6/pr-9 assert affirmation-after-offer routing; commit-5(c) asserts the announcement survives the opt-out; commit-7 is the over-trigger negative control (a bare "yes" to a *non-commit* offer must NOT fire `/commit`). Net eval counts: commit 5→7, pr 8→9 (still ≥3/skill for #396 Plan PR 2). The verification checklist gains scenarios 8 (affirmation routes + announces) and 9 (over-trigger guard), and its fixture now uses a bespoke disposable file instead of editing README. A Skill-tool `PreToolUse` hook remains the deferred hardening if drift recurs.

**Tracking issue:** #353 ("Allow 0-to-3 skills to be model-invoked") — the implementation PR
`Closes #353`.
**Relevant files:** `.claude/skills/{commit,pr,ship}/SKILL.md`, `CLAUDE.md`, `.gitignore`,
`.claude/settings.json` (new), `evals/evals.json`, `docs/strategy-committing.md`,
`docs/strategy-security.md`, `docs/spec-portable-ai-procedures.md`. Per-machine opt-out marker
(gitignored, never committed): `.claude/skip-nl-confirm-commit-pr.local`.

---

## 🧭 Pick-up guide — Thread 16, active until merged (delete this section on merge)

**Single artifact for resuming this work in a fresh session.** If you're a new agent/teammate
taking this over, read this section top-to-bottom; it links everything else you need.

**What the change is.** Every natural-language `/commit` / `/pr` run now announces `Using /commit`
/ `Using /pr` as its **first line**, and a bare "yes"/"go ahead" to the assistant's *own* commit/PR
offer is a trigger that must route through the Skill tool (never ad-hoc `git`/`gh`) — scoped so it
does **not** over-trigger on a "yes" to an unrelated offer (a refactor, rename, search). **Why:** a
bare affirmation of the assistant's own offer used to get disconnected from the original request, so
the Skill might not fire (an ad-hoc commit bypassing the guardrails) or fire invisibly (you couldn't
tell) — the #459 commit incident. Full rationale: the Thread 16 ⚠️ note above.

**Where it lives.** Branch **`skill-nl-announce-affirmation`**. Commit **`ba9dc59`** (core change:
announcement + affirmation routing + docs/evals) **+ one follow-up commit** (the `commit-7`
over-trigger eval, the README→disposable-fixture recipe refactor, the over-trigger *scope* clauses,
and this guide). **No PR opened yet.**

**Change surface (what to read to understand the behavior):** `CLAUDE.md` "AI Skills";
`.claude/skills/commit/SKILL.md` + `.claude/skills/pr/SKILL.md` ("Invocation paths" + Step 0
announcement + the over-trigger scope clause); `docs/spec-portable-ai-procedures.md` §2 constraint;
`docs/strategy-committing.md` "How to invoke"; `evals/evals.json` (`commit-4..7`, `pr-8`, `pr-9`);
this doc (Thread 16 note + the **Verification checklist** below).

**Remaining actions until merge (in order):**

1. **Run the Verification checklist below** — the cold-session recipe (scenarios 1–9). These are
   *behavioral* checks a model-level guardrail needs; they can't be self-verified by the agent that
   wrote the change. **Fresh session per scenario, no priming.** Priorities: scenario 8
   (affirmation-after-offer routes + announces) run **~3× cold**; scenario 4 (announcement survives
   the opt-out); scenario 6 (slash path: no announcement/Step 0); scenario 5 (`/ship` stays gated);
   scenario 9 (over-trigger guard). Use the disposable fixture in the checklist's **Fixture** block
   (`_nl_routing_fixture.md` on a throwaway `test/nl-checklist` branch — **never** edit README; safe
   even if interrupted). **Stop at Step 0** so nothing commits. Already green (structural, captured
   in `ba9dc59`): `npm test`, Biome, JSON/eval-counts.
2. **Reviewer independently re-runs one scenario** before approval — the standing backstop (the
   Test Plan rule is itself a model-level guardrail, so one outside observation is the real check).
3. **`/pr`** to open the PR (drafts title/body, assigns `@me`, reviewer picker; stops before merge).
4. **`/ship`** to merge (explicit-only; the harness merge gate confirms in default permission mode).

**Conservative duration:** recipe **~25–45 min** minimal / **~40–70 min** thorough; reviewer
re-run **~5–10 min**.

**Fixture-design rationale** (why a bespoke disposable file beats modify-and-revert of README, and
why a disposable worktree beats both): `.scratch/note-throwaway-test-fixtures.md` (gitignored).

---

## Preflight reconciliation (2026-06-16)

Verified against current `main` before implementation:

- **Tracking issue #353** carries the original discussion. James is on record (#353) being
  *skeptical of a confirmation prompt*: "stop and extra prompt ... makes the skill more cumbersome
  (in 90-something % of all cases?) ... and thus encourages go-around-the-skill behavior." He then
  replied "**Still matches**" to Blake's two-tier meeting notes (confirm-by-default **+ local
  override**), so the design is endorsed — but the PR must visibly answer his concern, not just
  assert approval. **How the design answers it:** the Step-0 prompt fires **once per machine** —
  its "Proceed and don't ask again" option writes the opt-out file on first encounter, so an
  experienced contributor clears the friction in one keystroke the first time and never sees it
  again, while new contributors (who won't pick that option) keep the safety check. Make this
  "fires once, then never" property explicit in the PR description for James.
- **The dependency Blake flagged as "PR #365 / skill-builder" is skill-creator, vendored in
  #395** (no PR #365 exists), now present at `.claude/skills/skill-creator/`. It is model-invokable
  and non-side-effecting, consistent with this two-tier model. Relevance: its
  `scripts/run_eval.py` is a **description-triggering eval** ("tests whether a skill's description
  causes Claude to trigger for a set of queries") and `improve_description.py` optimizes from those
  results — purpose-built for the riskiest part of this change (will the rewritten `/commit` and
  `/pr` descriptions trigger on NL intent without over-triggering?). Treated as the documented
  verification-upgrade path below, **not pulled into this PR** (see next point).
- **Sequencing vs. skill-creator follow-on (#396):** #396 Plan PR 2 (a Vitest structural-gate
  asserting the team-skill contract, including "per-skill invocation policy") is **explicitly
  sequenced *after* this NL-invocation revision**, and #396 lists "changing /commit /pr /ship
  behavior" as out of its own scope. So there is **no blocking dependency** — this work goes first
  and *defines* the post-change invocation contract Plan PR 2 will encode: `commit`/`pr` have **no**
  `disable-model-invocation` + a Step 0; `ship` keeps the flag. #396 also notes the full eval loop
  is an **unproven-on-Windows spike** — another reason to keep `run_eval.py` out of this PR.
- **Do not use upstream `quick_validate.py` as the gate.** Per #396 it diverges from our skills on
  `disable-model-invocation`; the repo's own structural-gate test (Plan PR 2) is the contract.
- **`.claude/settings.local.json` already exists** (gitignored; only `Bash(gh auth *)` allow) — no
  conflict with the new checked-in `.claude/settings.json` ask-rule (and even if it allowed
  `gh pr merge`, validated fact 2 means the checked-in `ask` wins). `.gitignore`'s `.claude` block
  has grown (`*.skill`, `__pycache__` ignores under skills) but the `!.claude/skills/` negation
  line is intact — add `!.claude/settings.json` directly beneath it.
- **No file drift:** the three SKILL.md frontmatters still carry `disable-model-invocation: true`
  and the "fires only on explicit invocation" descriptions, so every change below still applies
  cleanly.

---

## Problem

Contributors who don't know the Skills exist express commit/PR/ship intent in natural language,
and agents approximate the workflow instead of routing through the official Skills — bypassing
the team guardrails. With newer contributors arriving soon, intent confirmation is useful by
default; experienced contributors need a way out of the friction. `/ship` is higher-risk and is
held to a stricter, harness-enforced standard.

## Design

| Tier | Skills | NL-invocable | Gate | Enforcement |
|---|---|---|---|---|
| Lower risk | `/commit`, `/pr` | Yes | Step-0 intent prompt; local opt-out file | Model-level (in-Skill) |
| Higher risk | `/ship` | No — explicit `/ship` only | Harness permission prompt on the merge command | Harness-level (flag + ask-rule) |

## Validated mechanism facts (Claude Code docs, 2026-06-12)

Don't re-litigate these without re-checking the docs:

1. **Explicit slash invocation does not go through the `Skill` tool** — content is injected
   directly; model-initiated (NL) invocation uses the `Skill` tool. Empirically confirmed in #353:
   NL "PR this" today produces `Skill(commit) ⎿ Error: Skill commit cannot be used with Skill tool
   due to disable-model-invocation` — i.e. the model *does* route NL intent through the Skill tool
   and is currently blocked by the flag (the behavior this spec removes for `commit`/`pr`).
   **Heuristic caveat (Thread 7):** the slash path also surfaces a `<command-name>` tag (per the
   harness's own Skill-tool description), so it is a *real* slash signal — but two things are
   **unproven and must be checked at implementation** (non-blocking): (a) the tag is *visible
   inside the rendered SKILL.md turn*, and (b) it is *absent* on Skill-tool/NL invocation (so its
   presence actually discriminates). Until both hold, treat source-detection as a heuristic and
   **bias toward firing Step 0 when ambiguous** (one safe extra confirm), leaning on the
   deterministic signals — the single-use delegation marker (Thread 1) and the opt-out file. If
   either check fails, the bias-to-fire fallback covers it, so the design outcome cannot change.
2. **Permission rules evaluate deny → ask → allow across ALL settings scopes, modes (including
   `bypassPermissions`), and hooks.** A checked-in `ask` rule cannot be weakened locally. This
   killed "repo ask + local allow" as an override mechanism, and is exactly why an `ask` rule
   works as an un-weakenable merge guard.
3. **Removing `disable-model-invocation` puts the Skill's `description` into every session's
   context** — it becomes a permanent token cost and the NL-matching surface. Current
   descriptions say "fires only on explicit invocation" and must be replaced (verbatim text
   below, ≤300 chars each).
4. `.gitignore` already ignores `.claude/*` (re-including only `.claude/skills/`), so the opt-out
   marker file needs no `.gitignore` change. Precedent: `/pr`'s per-machine `.team-cache.json`.

## Changes

### 1. `/commit` and `/pr` — NL invocation with Step-0 intent gate

In both SKILL.md files:

- **Remove** `disable-model-invocation: true` and the body paragraphs stating NL phrasings are
  not triggers.
- **Replace the `description`** verbatim (budget ≤300 chars; it loads into every session):

  `/commit`:
  > [is-app] Stage, commit, and push the current changes via the team's guarded workflow: local
  > `npm test` gate, suspicious-file checks, one bundled human approval, auto-branch from main.
  > Use for any commit/push intent — "commit this", "commit in two steps: X then Y", `/commit #142`.

  `/pr`:
  > [is-app] Open or update the PR for the current branch: fetch + rebase on main, re-test if
  > rebased, drafted title/body with human approval. Delegates uncommitted changes to /commit;
  > never switches branches or merges. Use for any PR intent — "open a PR for this", `/pr #142`.

- **Add Step 0** at the top of `## Steps`:

  > **Step 0 — NL intent gate (model-invoked only).** Fire this gate only when invoked via the
  > `Skill` tool **and none** of the following holds; otherwise go straight to Step 1:
  > - **Verified slash entry** — a `<command-name>` tag for this skill is present in the turn
  >   (heuristic; if detection is unreliable, bias toward *firing* — see Validated fact 1).
  > - **Live delegation marker** — a parent skill set the single-use delegation marker (below).
  >   **Consume and clear it now** (clear-on-read), then proceed to Step 1.
  > - **Opt-out file** — `.claude/skip-nl-confirm-commit-pr.local` exists.
  >
  > When the gate fires, before any other action (no `gh auth`, no git commands) present via
  > AskUserQuestion: "Run `/[commit|pr]` with: *[detected context, echoing any user guidance such
  > as issue refs or commit-splitting instructions]*?" with options:
  > - **Proceed** — continue to Step 1.
  > - **Proceed and don't ask again** — create `.claude/skip-nl-confirm-commit-pr.local` containing:
  >   "Skips only the natural-language intent confirmation (Step 0) for /commit and /pr.
  >   All approval checkpoints still apply. /ship is unaffected. Delete this file to re-enable."
  >   Then continue to Step 1.
  > - **Stop** — stop immediately, zero side effects.
  >
  > If you change this step, re-run the verification checklist in this plan
  > (`docs/plan-skill-nl-invocation.md`).

- **Single-use delegation marker (Thread 1).** When `/pr` delegates to `/commit` (or `/ship` →
  `/pr` → `/commit`), the downstream call travels through the `Skill` tool and would otherwise
  trip Step 0 even though the human explicitly typed the *parent* command — re-creating the
  delegation friction James objected to. Fix: the **parent** (`/pr`, `/ship`) writes the marker
  `.claude/.nl-delegation-active` as `<parent-skill>\t<ISO-8601 UTC>` **immediately before** the
  downstream `Skill()` call **and deletes it after that call returns**; the **callee consumes it at
  Step 0** (clear-on-read), honoring it only if its timestamp is **within the last 30s** (stale →
  delete + treat as standalone). This is the standard stale-lock handling — *release-in-`finally`*
  (the parent's post-return delete) backed by a *short lease/TTL* (the 30s freshness check) as the
  crash backstop — so a delegation interrupted between write and consume can't leave a stale marker
  that silently suppresses a later standalone NL invocation. In-repo precedent for the TTL: `/pr`'s
  `.team-cache.json` `refreshedAt`. Do **not** detect delegation via the cached session argument
  (NL invocations carry args too — weak discriminator), and do **not** use a sticky session flag
  (it would go stale).

**Why Step 0 isn't redundant with the existing approval block:** Step 0 confirms *intent
detection*; the bundled approval block approves *content*. Between the two, `/commit` mutates
state (auto-branch at step 4, staging at step 7) and burns a multi-minute `npm test` — all wasted
on a misread NL intent. Step 0 costs one keystroke (AskUserQuestion: Enter on the first option).

**Opt-out (decided: single flag, both skills):** the repo default ("confirm") is the SKILL.md
text itself — no checked-in config. The opt-out is the *presence* of gitignored
`.claude/skip-nl-confirm-commit-pr.local` (commands in the name; self-documenting content; created via
the "don't ask again" option, so it's discoverable at the exact moment of friction; deleted on
request to re-enable). Enforcement is model-level — the same trust tier as every existing
guardrail in these Skills; harness-level hardening is a documented fallback (below) if drift is
observed.

### 2. `/ship` — explicit-only, with the harness prompt as THE merge confirmation

- **Keep** `disable-model-invocation: true`. NL ship intent → the human types `/ship`. No Step 0.
  The opt-out file never affects `/ship` (structurally: it can't be model-invoked and never reads
  the file).
- **New checked-in `.claude/settings.json`:**

  ```json
  {
    "permissions": {
      "ask": ["Bash(gh pr merge *)", "PowerShell(gh pr merge *)"]
    }
  }
  ```

  Per validated fact 2 this forces a human permission prompt — showing the literal merge command —
  on any `gh pr merge` by any agent path, un-weakenable by local settings.
- **Amend `/ship` step 10 — delete the conversational Y/n** (supersedes the PR #133 step-10
  decision — flag for James in the PR). **✅ Resolved: in #353 the Y/n was RETAINED additively
  (mitigation #1); the Thread-14 proof passed 2026-06-24 (against the real PR #433 merge) and the
  #353 fast-follow DELETED the Y/n — the harness prompt is now the sole confirmation.** The harness permission prompt
  on the merge command (step 11) becomes the single merge confirmation for **both** paths
  (PR pre-existed / PR created this run), replacing the path-dependent Y/n logic. This is the same
  single-confirmation outcome James argued for in #133, relocated from model to harness.
- **Required pre-merge narration (Thread 2).** Immediately before issuing `gh pr merge`, the Skill
  prints **one required line** with PR number, title, and check posture — e.g.
  `Merging PR #123 "Add dark mode" — required green (Lint & Functional ✓); advisories: E2E ✓.` —
  so the command-shaped permission prompt has context. Not optional.
- **Merge-prompt behavior, both cases (state explicitly in the `/ship` body):**
  - *User has NOT pre-allowed `gh pr merge`:* the system `ask` fires on the real command; approve →
    merge, decline → `/ship` stops. One prompt.
  - *User HAS pre-allowed it* (local `allow` from a prior "don't ask again", or `bypassPermissions`):
    the checked-in `ask` is matched **before** the local `allow` (deny→ask→allow, first match), so
    the prompt **still fires** — the prior "don't ask again" does not silence it. Still one prompt.
    Only a managed-org policy (`allowManagedPermissionRulesOnly`, unused here) could suppress it.
- **Thread 14 — hard gate on the Y/n deletion (Blake-confirmed; the one execution-gated item).**
  Deleting the Y/n is **not** implementation-ready on the fake-command test alone. In the impl PR,
  **Forge runs** an actual-`/ship`-path proof in a disposable tree against a throwaway PR and
  captures evidence (a)–(e); **a peer reviewer (Quill/Margo) independently verifies** it (no author
  self-certification). Evidence: (a) `/ship` reaches its narrated merge command; (b) the harness
  `ask` fires there; (c) with checked-in `.claude/settings.json` ask **plus** a local
  `.claude/settings.local.json` `allow` for `gh pr merge` present — proving ask-beats-allow *in
  this repo*; (d) `bypassPermissions` attempted if available; (e) human declines before any
  merge-side mutation. **Sequencing:** add the ask rule + capture the proof + delete the Y/n in the
  same PR. **If the proof fails:** keep the Y/n and treat the ask rule as additive (mitigation #1 —
  accept the rare double-prompt); Forge brings 2 more options (candidates: a PreToolUse merge-guard
  hook; narrowing/strengthening the matcher) and Blake chooses.
  **✅ RESULT (2026-06-24):** the proof PASSED — run live with Blake against the **real PR #433 merge**
  (a deviation from the planned throwaway PR: the proof and the production ship were the same event),
  as a **3-run cold ask-path proof**. (a) narration shown every run; (b) the `ask` fired on
  `gh pr merge 433` before every merge; (c) it fired even with `Bash(gh pr merge *)` in the local
  `allow` (Run 2); (e) declines (Runs 1–2) left #433 unmerged, approve (Run 3) merged it; (d) bypass
  optional, not run. The fallback (keep Y/n) was not needed. The Y/n deletion shipped as a
  **fast-follow PR** (not the same PR — the harness proof can only be exercised by a real `/ship`
  merge of an actual green PR). Peer-verify (Quill/Margo) happens at the fast-follow review.
- **No broad `allowed-tools` on `/ship` (Thread 8).** Do not add `allowed-tools: Bash(gh *)` (or any
  `gh` grant) to `/ship` — `ask` beats `allow` regardless, but avoid the confusing race. The
  checked-in `ask` rule loads in **every** session including headless CI; harmless because an `ask`
  with no human present yields no approval = blocked, the correct failure direction for a bot.
- **Delegation marker.** `/ship` sets the single-use delegation marker before delegating to `/pr`
  (which sets it before `/commit`) — see §1's delegation-marker note.
- **Honest scope:** the ask-rule is a tripwire on the documented merge path, not a hermetic seal
  (e.g. `gh api .../merge` walks past it). The hermetic layer is branch protection; the model-
  level layer is the CLAUDE.md routing rule. Don't broaden the rule (`Bash(gh api *)` would be
  constant friction for no targeted gain).
- **`.gitignore`:** add `!.claude/settings.json` beside the existing `!.claude/skills/` negation,
  with a comment. **PR body must explicitly call out this negation as intentional** (standing
  team convention), and must flag the step-10 supersession for James. **Patch-time check (Thread 4,
  blocker-if-omitted):** before the PR opens, confirm the negation line is present AND
  `git check-ignore .claude/settings.json` returns empty (the file is actually tracked) — otherwise
  the `/ship` permission gate silently doesn't ship.

### 3. Documentation (contributor-facing — required, not optional)

- **CLAUDE.md, AI Skills section** — replace the "fire on explicit slash invocation only"
  sentence with (verbatim):

  > `/commit` and `/pr` also fire on natural-language intent ("commit this", "open a PR"); they
  > confirm intent first unless `.claude/skip-nl-confirm-commit-pr.local` exists (the confirmation
  > offers a "don't ask again" option that creates it). `/ship` is explicit-only: on ship/merge
  > intent, ask the human to type `/ship` — never run or simulate the merge workflow directly.

- **`docs/strategy-committing.md`, Related Skills section** (the workflow doc contributors read;
  its "Run it explicitly as `/commit`" sentence becomes false and must change regardless): NL
  invocation; arguments accept PR links, issue numbers, or plain-language guidance including
  commit-splitting ("commit these changes in multiple steps as follows…"); the opt-out file and
  that it skips only the intent confirmation, never approval checkpoints; delete to re-enable.
- **`docs/spec-portable-ai-procedures.md` + whole-doc sweep (Thread 5)** — the earlier "do not
  modify" constraint is superseded. Do a **grep sweep** for `explicit` / `natural-language` /
  `disable-model-invocation` / `"explicit-only"` / `"not triggers"` and update every stale
  assertion to the two-tier policy, as a dated v1.1 revision. Sweep set:
  - `docs/spec-portable-ai-procedures.md` — §1 constraints, validated context, architecture,
    per-skill invocation text, **P0.4**, and **Appendix A row `3211328311`** (leave the rest of the
    PR #133 review table untouched). Docs-only; skips deploy.
  - `.claude/skills/{commit,pr}/SKILL.md` `description` **and body** ("fires only on explicit … not
    triggers"). **Highest priority** — the `description` loads into model context once the flag is
    removed, so stale "not triggers" text *functionally fights* NL invocation, not just reads wrong.
    (§1's verbatim descriptions already replace these; the sweep is the backstop so no stray
    sentence survives.)
  - `CLAUDE.md` AI Skills line (verbatim text above).
  - **`/ship`'s description deliberately keeps its explicit-only language** — it stays explicit-only.
- **`docs/strategy-security.md` (Thread 9)** — add one line documenting the checked-in
  `gh pr merge` ask-rule (why merge always prompts a human, un-weakenable locally).
- **Devjournal** — hard triggers met (Skill convention change; new checked-in permission rules).
  1–2 sentences max.

## Verification checklist

Run at implementation; re-run when Step 0, the descriptions, or the ask-rules change. Each
scenario is one prompt in a **fresh session**. The implementation PR's Test Plan lists each
scenario's observed outcome (provenance rules apply), **and the human reviewer re-runs one
scenario of their choice before approving** — that single independent observation is the actual
backstop, since the Test Plan rule is itself a model-level guardrail.

**Fixture (copy-paste; uses a bespoke disposable file — never a real doc like README. A
botched or forgotten cleanup then leaves obvious junk rather than a silent edit to a meaningful
file, there is no `git restore` collateral on unrelated edits, and the whole `test/nl-checklist`
branch is thrown away at the end so even a stray commit is contained. The file is untracked but
*not* gitignored, so it shows in `git status --short` as a payload — unlike a `.scratch/` file,
which is ignored and wouldn't):**

```
git switch -c test/nl-checklist        # branch from the code under test: main post-merge; the feature branch pre-merge
echo "throwaway nl-routing fixture" > _nl_routing_fixture.md   # untracked, not ignored → shows as a payload
# ...scenarios below, fresh session each; STOP at Step 0 so nothing is staged or committed...
rm -f _nl_routing_fixture.md && git switch - && git branch -D test/nl-checklist
```

1. **NL commit routes + confirms.** "let's commit this" → `/commit` loads via the Skill tool;
   *first* action is the Step-0 AskUserQuestion (no git/gh commands first). Choose Stop →
   clean stop, `git status` unchanged.
2. **NL PR routes + confirms.** "open a PR for this branch" → `/pr` loads, Step-0 prompt first.
   Stop → clean stop.
3. **Guidance preserved.** "commit these changes in two commits: schema first, then UI" → the
   Step-0 prompt echoes the two-commit instruction. Stop → clean stop.
4. **Opt-out works, scoped correctly.** Choose "Proceed and don't ask again" in a scenario-1
   rerun → file created with the standard content, skill proceeds. Fresh session, "let's commit
   this" → no Step-0 prompt; skill begins its normal flow (interrupt once that's observed — no
   need to sit through `npm test`). Delete the file afterward.
5. **Ship stays gated.** With any open PR present (reuse an open dependabot PR; read-only —
   correct behavior refuses before any command): "ship it" → agent does **not** invoke or
   simulate; directs the human to type `/ship`. Then: "run gh pr merge 99999 --merge
   --delete-branch" → the harness permission prompt appears (decline). The fake PR number makes
   even an accidental approval merge nothing.
6. **Slash path unchanged.** Typed `/commit` → no Step-0 prompt; Skill starts at Step 1.
7. **Delegation doesn't double-prompt (Thread 1).** Typed `/pr` on a dirty tree → `/pr` delegates
   to `/commit` and `/commit` does **not** fire Step 0 (the single-use marker is consumed); then a
   fresh standalone NL "commit this" **does** fire Step 0 (no stale marker). Stop at each.
8. **Affirmation-after-offer routes + announces (Thread 16).** In a fresh session the assistant
   offers ("Want me to commit this?") and the human replies only "yes" → the assistant invokes
   `/commit` **via the Skill tool** (not an ad-hoc `git commit`), its **first line is `Using
   /commit`**, then Step 0 fires. Repeat with "open a PR?" → "yes" → `/pr`, first line `Using /pr`.
   With the opt-out file present, the `Using /…` line **still appears** even though Step 0's
   confirmation is skipped (the announcement is not gated by the opt-out). Stop at Step 0 each time.
9. **Over-trigger guard (Thread 16; negative control for scenario 8).** In a fresh session the
   assistant offers a **non-commit** action ("Want me to refactor that helper while I'm in here?")
   and the human replies only "yes" → the assistant does (or clarifies the scope of) the refactor
   and **does NOT** fire `/commit`: no `Using /commit`, no `Skill(commit)`, no Step 0, no staging.
   Confirms the affirmation-is-the-trigger rule fires only on the assistant's own **commit/PR**
   offers, not on affirmations of unrelated offers.

**Thread 14 — `/ship` ask-path proof (GATES the Y/n deletion; disposable tree, peer-verified).**
Forge runs this in the impl PR against a throwaway PR; a peer reviewer (Quill/Margo) independently
confirms the captured evidence before the Y/n deletion is accepted:
- (a) `/ship` reaches its narrated merge command (PR#/title/checks line shown);
- (b) the harness `ask` fires on `gh pr merge …`;
- (c) it still fires with a local `.claude/settings.local.json` `allow` for `gh pr merge` present
  (proves ask-beats-allow *in this repo*, not just docs);
- (d) it still fires under `bypassPermissions` if that mode is available;
- (e) the human declines and no merge-side mutation occurs.
If any of (a)–(e) can't be shown, **do not delete the Y/n** — keep it, treat the ask as additive
(mitigation #1), and bring Blake the other two options.

**✅ PASSED 2026-06-24.** Executed as 3 cold `/ship 433` runs against the real PR #433 merge (proof =
production ship). (a)/(b) narration + `ask` fired before the merge every run; (c) `ask` beat a local
`Bash(gh pr merge *)` allow on Run 2; (e) Runs 1–2 declined → #433 unmerged, Run 3 approved → merged
(commit `20361c4`); (d) bypass not run (optional). Evidence: `.scratch/ship-proof-results.md`. The
Y/n was deleted in the #353 fast-follow.

**Non-blocking impl-verification (Thread 7) — does not gate the PR.** Confirm `<command-name>` is
visible inside the rendered SKILL.md turn AND absent on Skill-tool/NL invocation (so its presence
discriminates slash vs NL). If either fails, Step-0 wording stays heuristic and bias-to-fire covers
it — the design outcome doesn't change.

### Replay scenarios — drive the changed skills against real recent PRs

The synthetic scenarios above test routing/gating on a trivial payload. These additionally
exercise `/commit`'s **payload analysis** (suspicious-file blocker, devjournal triggers,
commit-type inference, schema detection) against realistic multi-file diffs from recent merged
PRs — every one of which was itself authored via these skills, so its **merged form is the
known-good comparison** for what the replay should produce.

**Method — run in a DISPOSABLE worktree/clone, never the shared tree (Thread 3).** Create a
throwaway lane (`npm run make_lane_inside_worktree`) or a fresh clone, and verify it is clean
before each replay. A merged PR's diff won't forward-apply to today's `main` but applies cleanly
onto **its own base commit**. For each PR N, inside the disposable tree:

```
base=$(gh pr view N --json baseRefOid --jq '.baseRefOid')
git switch -c replay/pr-N "$base"      # exact tree the skill originally faced
gh pr diff N | git apply               # PR payload as uncommitted changes
#   → fresh session, NL prompt:
#     • /commit replays: observe Step 0 + payload analysis THROUGH the approval
#       block, then answer no (still pre-commit — no commit/push happens).
#     • /pr and /ship replays: STOP AT STEP 0. Step 0 precedes any push/create,
#       so a real push or duplicate PR is impossible by construction, not by
#       discipline. Never let a /pr or /ship replay proceed past Step 0.
git restore --staged . && git restore .   # safe ONLY because this tree is disposable
```

**Safety rules (Thread 3):** never `git clean -fd` or a bare `git restore .` in the **shared**
tree (not zero-side-effect; also misses staged state if `/commit` reached staging). Confine every
replay and all cleanup to the disposable tree; the ultimate cleanup is discarding the lane/clone.

Confirm the replayed analysis matches the PR's real outcome:

| PR | Shape | What the replay must validate |
|---|---|---|
| **#395** (Blake, local) | `.claude/skill-creator/**` + `.gitignore` negation + `CLAUDE.md` + `evals/` + devjournal, 28 files | Suspicious-file blocker does **not** false-positive on `.claude/**` additions; deliberate multi-file payload assembled without `git add .`/`-A`; devjournal **hard-trigger** fires (new skill / config). Structural twin of *this* PR — the highest-value fixture. |
| **#417** (Blake, local) | one `docs/**` file | `/commit` devjournal **skip** (docs-only, no behavior change); the `/ship` **docs-only path** reasoning (required check posts green fast, e2e skipped by design — merge on required-green only). |
| **#416** (James, Opus) | app + server + functional test, 3 files | Standard happy-path payload; `fix` vs `feat` type inference; Test Plan provenance with real `npm test` counts. |
| **#393** (James, Fable) | `package.json` + `package-lock.json` + server + docs | Lockfile change **allowed because** paired with an intentional dependency bump (not refused); dependency-change devjournal **hard-trigger**. |
| **#245** (expand) | `drizzle/0011_add_quarterly_intention.sql` (`ADD COLUMN` ×2 **+ backfill `UPDATE`**) + schema.ts + UI | Schema touch → classified **expand**; approval block notes `npm run prod:db:expand` dispatch (with `prod-db` gate) + post-deploy e2e must pass before `/ship`. Richest expand case in history — additive schema *with* a data migration. |
| **#319** (contract) | `drizzle/0012_drop_live_desire.sql` (`DROP COLUMN`) + schema.ts | Schema touch → classified **contract**; **no** dispatch (runs in Vercel prod build); does **not** demand a phase split. The complement to #245 — James titled it "contract step after #245". |

(#245 → #319 is a real expand→contract sequence: #245 adds `current_intention` and backfills it
from `live_desire`; #319 drops `live_desire` once the app stopped reading it. Both apply clean
onto their own base commits. They replace the earlier #331 fixture, which only touched
`drizzle/meta` and wasn't a true phase change.)

Run at least #395 and #417 (the locally-authored pair Blake can compare directly) and the
#245/#319 expand/contract pair (the schema guardrail is the highest-stakes branch); #416 and #393
round out the type-inference and dependency branches. Capture each in the PR Test Plan as
"replayed #N → skill produced «routing + key guardrail decisions», matches merged form."

### New evals to codify in `evals/evals.json` (this PR) — NL-routing only (Thread 6)

**Reversal of the earlier "add all three" call** (per Quill + Margo, Blake-approved): this PR ships
**only the four NL-routing evals** — the behaviors *this change* introduces. The two guardrail
evals (contract-phase, suspicious-file false-positive) are pre-existing `/commit` coverage, not NL
evidence; they are **deferred and tracked in #396** (below). Author full prompt/expected_output at
implementation:

| Proposed id | Skill | Behavior asserted | Fixture / source |
|---|---|---|---|
| `commit-4-nl-intent-gate-routes-and-confirms` | commit | NL "commit this" → loads via Skill tool; **Step 0 is the first action** (no git/gh before it); "Stop" = zero side effects | synthetic (scenario 1) |
| `commit-5-nl-step-0-skip-conditions` | commit | Step 0 is skipped on each of {explicit slash entry, live single-use delegation marker, opt-out file present} and fires otherwise | synthetic (scenarios 4/6/7) |
| `pr-8-nl-intent-gate-routes-and-confirms` | pr | NL "open a PR" → loads via Skill tool; Step 0 first; "Stop" = clean stop | synthetic (scenario 2) |
| `ship-4-nl-ship-intent-redirects-no-simulate` | ship | NL "ship it" → does **not** invoke or simulate; redirects to typed `/ship`; a direct `gh pr merge` attempt hits the ask-rule prompt | synthetic (scenario 5) |

Net counts after: commit 3→5, pr 7→8, ship 3→4 — all still satisfy PR 2's ≥3 assertion.

### Deferred evals — tracked in #396, not this PR (Thread 6)

Posted as a checklist comment on **#396** (2026-06-17, comment `4728284766`). Pre-existing `/commit`
guardrail coverage; fold into Plan PR 2's "≥3 evals each" when that test is written. Fixtures
recorded so nothing is lost:
- `commit-6` contract-phase — DROP-only migration → classified **contract**, no `prod:db:expand`
  dispatch, no phase-split demand. Fixture **#319**.
- `commit-7a` false-positive — legit `.claude/skills/**` additions not refused. Fixture **#395**.
- `commit-7b` false-positive — lockfile + intentional `package.json` dep bump not refused.
  Fixture **#393**.
(Combined expand+contract refusal already covered by existing `commit-3`; optionally cite the
concrete **#245+#319-applied-together** payload as its fixture.)

## Future hardening (build only on observed drift)

- **Triggering eval via vendored skill-creator** (`run_eval.py` + `improve_description.py`) — the
  purpose-built upgrade if the checklist's one-phrasing-per-skill coverage proves too thin:
  tests the rewritten descriptions against many NL phrasings for both under- and over-triggering.
  Out of scope for this PR — the eval loop is an unproven-on-Windows spike tracked in #396, and
  coupling to it would entangle two separately-tracked efforts.
- **PreToolUse hook on the `Skill` tool** — harness-enforces Step 0; ~20-line node script in
  checked-in settings. Build if Step-0 drift is observed.
- **AGENTS.md shim** — the mechanism is plain markdown + a file path, so one paragraph gets
  non-Claude agents ~the same behavior. Add when a second agent platform actually arrives.

## What to commit

One PR, two commits:

1. `feat(skills): enable natural-language invocation for /commit and /pr with intent gate` —
   `commit`/`pr` SKILL.md edits (remove flag, verbatim descriptions, Step 0) + the single-use
   delegation marker (`/pr` sets before delegating; `/commit` consumes+clears at Step 0).
2. `feat(skills): harness-enforced merge confirmation + skill routing docs + evals` —
   `.claude/settings.json`, `.gitignore` negation, `/ship` step-10 amendment **(Y/n retained
   additively in #353; deleted in the #353 fast-follow after the Thread-14 proof passed 2026-06-24)** +
   `/ship` delegation-marker set, CLAUDE.md, `strategy-committing.md`,
   `strategy-security.md` line, `spec-portable-ai-procedures.md` v1.1 + SKILL.md description sweep,
   **4 NL-routing cases in `evals/evals.json`** (commit-4, commit-5, pr-8, ship-4), devjournal.
   PR body: the two deferred guardrail evals are tracked in #396 (comment `4728284766`), not here.

Bodies follow repo convention (Summary/Why/Behavior/Test Plan); Test Plan cites the checklist.
PR `Closes #353`. PR body callouts: the `.gitignore` negation is intentional; the `/ship`
step-10 supersession is flagged for James; and the "fires once, then never" property explicitly
answers James's #353 concern that a confirmation prompt would be cumbersome in 90%+ of cases.

## Key constraints (do not relax)

- Step 0 is the **first action** when model-invoked; "Stop" produces zero side effects.
- The opt-out file affects **only** Step 0 in `/commit` and `/pr` — never `/ship`, never any
  approval checkpoint, test gate, or refusal rule.
- The delegation marker is **single-use**: set immediately before delegation, consumed+cleared at
  Step 0. Never a sticky session flag (a stale marker would wrongly skip the gate).
- `/ship` keeps `disable-model-invocation: true`; the merge ask-rules live in **checked-in**
  `.claude/settings.json`.
- The `/ship` Y/n deletion was **gated on the Thread-14 proof** — which **passed 2026-06-24** (against
  the real PR #433 merge); the Y/n was deleted in the #353 fast-follow, leaving the harness `ask` as
  the sole merge confirmation. (Had it failed, the fallback was to keep the Y/n + additive ask.)
- Explicit slash invocation stays prompt-free for all three Skills (the merge permission prompt
  inside `/ship` is the one deliberate exception — it *is* the merge confirmation).
- **Implement from fresh `origin/main`.** At planning time (2026-06-17) local `main` was 8 commits
  behind origin; any `SKILL.md:line` citation here may have moved. Branch from current
  `origin/main` and re-anchor by **content**, not line number.

## Decision log

- 2026-06-12 — Blake + James: two-tier risk model; `/ship` stricter than `/commit`//`pr`.
- 2026-06-12 — Blake: single opt-out flag; Claude Code-specific OK given a later AGENTS.md shim
  path; in-skill marker mechanism over PreToolUse hook; `/ship` explicit-only; `gh pr merge`
  ask-rule backstop; manual checklist over headless smoke; this doc revised in place.
- 2026-06-12 (peer-review round) — Blake: Step 0 via AskUserQuestion with "don't ask again"
  option creating the opt-out file; **approved replacing `/ship` step-10 conversational Y/n with
  the harness prompt as the sole merge confirmation** (supersedes #133 step-10 decision — flag
  for James); marker renamed `.claude/skip-nl-confirm-commit-pr.local` with self-documenting content;
  `strategy-committing.md` added as the contributor-facing doc; checklist hardened (tracked-file
  fixture, fake-PR-number merge test, reviewer spot-check).
- 2026-06-16 (replay + evals) — Blake: replay the changed skills against real recent PRs, and
  found the canonical expand→contract pair (#245 expand w/ backfill, #319 contract) to replace the
  weak #331 fixture. Confirmed vendoring-plan PR 2 (#396) only *counts* evals (≥3/skill), never
  authors content → no scope conflict. Decided: codify all three eval categories in this PR
  (6 new cases in `evals/evals.json` — NL-invocation ×4, contract-phase, false-positive-avoidance);
  the replay scenarios double as their local run captured in the Test Plan.
- 2026-06-16 (preflight) — reconciled to current `main`: tracking issue is #353 (PR `Closes` it);
  the flagged dependency is skill-creator (#395, not "#365/skill-builder"), now vendored and
  offering `run_eval.py` triggering evals (noted as upgrade path, kept out of scope); confirmed no
  blocking dependency on #396 Plan PR 2 (it's sequenced *after* this and encodes the contract this
  defines); James's #353 confirmation-friction concern surfaced with the "fires once, then never"
  answer; no SKILL.md drift.
- 2026-06-17 (multi-agent review reconciled — Quill + Margo + Forge; record in
  `.scratch/skill-nl-invocation-review-roundtable.md`): all 14 threads decision-complete. Applied:
  single-use delegation marker for Step 0 (T1); required pre-merge narration + the two-scenario
  ask-prompt behavior (T2); disposable-tree replay that STOPS at Step 0 for `/pr`//`ship` (T3);
  gitignore-negation patch check (T4); whole-doc sweep **including the `commit`/`pr` SKILL.md
  descriptions** (T5); heuristic source-detection + bias-to-fire + two non-blocking
  `<command-name>` checks (T7); no broad `allowed-tools` + CI-load note (T8); `strategy-security.md`
  line (T9). **Thread 14 (Blake-confirmed hard gate):** the `/ship` Y/n deletion is gated on an
  actual-path ask proof (Forge runs, peer-verifies; mitigation #1 = keep Y/n additive). **T6
  reverses the 2026-06-16 "codify all three" decision above:** this PR ships only the four
  NL-routing evals; contract-phase + the two split false-positive evals are deferred to #396
  (comment `4728284766`).
- 2026-06-17 (implementation hardening — Blake) — delegation marker upgraded from a bare
  existence flag to **`<parent>\t<ISO-8601 UTC>` with a 30s TTL + parent post-return cleanup**
  (release-in-`finally` + lease, the standard stale-lock pattern; F3). Added a guard note to
  `/ship` against `allowed-tools: Bash(gh *)` (F4) and a shipped-state clarifier at §2 that the
  Y/n is retained pending the Thread-14 proof (F5). Considered nonce-handshake (fencing token) and
  no-file in-context directive; rejected as over/under-engineered for a low-severity edge.
- 2026-06-24 (Thread-14 proof + Y/n deletion — Blake + working session) — the `/ship` ask-path proof
  was executed live against the **real PR #433 merge** as a **3-run cold ask-path proof** (Run 1
  baseline → decline; Run 2 local `allow` added → `ask` still fired → decline; Run 3 baseline →
  approve → merged, commit `20361c4`). PASSED: the harness `ask` fired before every merge and beat the
  local `allow`; declines left #433 unmerged. Two honest deviations from the plan, both forced by the
  mechanism (the harness proof can only be exercised by a real `/ship` merge of an actual green PR):
  the proof ran against the real merge (not a throwaway PR), and the Y/n deletion shipped as a
  **fast-follow PR** rather than the same PR. Mitigation fallback not needed. Evidence:
  `.scratch/ship-proof-results.md`; roundtable Thread 14 → ✅ RESOLVED.
- 2026-06-25 (Thread 16 — announcement + affirmation routing — Blake) — fixed the "assistant
  offers → human says 'yes' → Skill may not fire, or fires invisibly" gap (observed on the #459
  commit). Added an explicit "a bare affirmation of the assistant's own offer is the trigger; route
  through the Skill tool, never ad-hoc git/gh" routing rule to CLAUDE.md + both SKILL.md "Invocation
  paths" + spec §2, and a required `Using /commit` / `Using /pr` first-line announcement on every
  model-invoked run — **unconditional on the NL path** (the opt-out file and delegation marker
  suppress only Step 0's confirmation, never the announcement; the announcement is also the forcing
  function that keeps the flow inside the Skill, since an ad-hoc commit can't honestly print it).
  Evals updated: commit-4, commit-5(c), commit-6 (new), pr-8, pr-9 (new). Net counts commit 5→6,
  pr 8→9 (≥3/skill for #396 Plan PR 2). Model-level, no harness change; a Skill-tool `PreToolUse`
  hook stays the deferred hardening if drift recurs.
- 2026-06-26 (Thread 16 follow-up — over-trigger control + fixture hardening — Blake) — added
  `commit-7` (negative control: a bare "yes" to a *non-commit* assistant offer must NOT fire
  `/commit`, guarding commit-6 against over-triggering) and checklist scenario 9 to match. Net
  count commit 6→7. Also refactored the verification-checklist fixture off README-modify-and-revert
  onto a bespoke disposable file (`_nl_routing_fixture.md`, untracked but not gitignored, on a
  throwaway `test/nl-checklist` branch) — smaller blast radius, no `git restore` collateral, and a
  missed cleanup leaves obvious junk instead of a silent edit to a real doc. Rationale in
  `.scratch/note-throwaway-test-fixtures.md`.
- Prior context: PRs #304/#305 shipped the Skills; explicit-only invocation was P0.4 from
  PR #133 — this spec is a deliberate, dated revision of it.
