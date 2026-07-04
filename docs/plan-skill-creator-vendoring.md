# Plan: Vendor `skill-creator` + Drift Management + Skill Eval Gates

**Status:** PRs 1–3 shipped (PR 1 #395 2026-06-14; PR 2 #485 2026-07-02; PR 3
`skill-creator-drift` 2026-07-03). NL-invocation prereq shipped (#353/#433/#459/#460,
2026-06-24). #396 complete; PRs 4–5 deferred.
**Relevant files:** `.claude/skills/`, `evals/`, `scripts/`, `.github/workflows/`,
`docs/spec-portable-ai-procedures.md`

---

## Problem

The team's `/commit`, `/pr`, and `/ship` Skills were built with Anthropic's upstream
[`skill-creator`](https://github.com/anthropics/skills/tree/main/skills/skill-creator) skill, but
skill-creator itself is not in the repo — each person must manually mount a dumped copy. That
doesn't scale to the team. We want repo-local access on clone, while still benefiting from
upstream Anthropic maintenance, without uncontrolled drift.

Secondary gap, discovered while planning: nothing validates our Skills today. `evals/evals.json`
is a committed acceptance artifact that no code executes; PR #304 shipped the Skills gated only by
the normal repo CI plus human review.

## Decision

**Vendor the `skills/skill-creator/` subdirectory into `.claude/skills/skill-creator/`, pinned to
an upstream commit SHA, refreshed by a small Node script.** Five PRs, sequenced below: vendor
(1), deterministic structural gate (2), scheduled drift detection (3), then two deferred
upgrades (4, 5).

Why vendoring wins: skill-creator is a *subdirectory of a monorepo*, and Claude Code auto-loads
project skills only from `.claude/skills/<name>/`. Vendoring puts it exactly there — zero setup
for every teammate on clone, riding the `.gitignore` negation (`!.claude/skills/`) the repo
already has. Updates are deliberate, reviewed PRs (pinned SHA), so upstream maintenance flows in
without silent drift.

## Alternatives rejected

- **Git submodule / subtree** — both operate on whole repos; neither can extract one
  subdirectory or land it at the path Claude Code loads. Submodules add clone friction
  (`--recurse-submodules`) and Windows symlink fragility; subtree imports the entire monorepo
  under a prefix.
- **Claude Code plugin marketplace** (`/plugin marketplace add anthropics/skills`) — native and
  low-maintenance, but per-user install, tracks upstream `main` (uncontrolled drift), and the
  only bundle containing skill-creator (`example-skills`) installs ~11 other model-invokable
  skills. No upstream plugin ships skill-creator alone.
- **Status quo (manual per-user copies)** — the problem being solved.
- **Upstream `quick_validate.py` as the CI gate** — would couple our merge gate to upstream's
  generic validator (their notion of "valid", their Python deps, their interface changes), and
  needs Python in CI. Our gate asserts *our* spec instead; `quick_validate.py` remains a local
  authoring aid.
- **Behavioral LLM evals as a blocking CI gate** — nondeterministic; a flaky required check is
  how `main` stalls. Behavioral evals stay local at authoring/refresh time and later
  advisory-only (PR 5).
- **Auto-PR drift automation first** — needs a PAT/App token so the bot PR triggers required
  checks. A tracking issue (PR 3) gets the same signal with the default `GITHUB_TOKEN`; the
  auto-PR upgrade (PR 4) is deferred until the cadence proves annoying.

## Validated facts (don't re-litigate without re-checking)

1. Dependabot watches packaged ecosystems + `gitsubmodule` only — it cannot watch a vendored
   directory. It *does* maintain `uses:` action pins in any new workflow via the existing
   `github-actions` ecosystem block in `.github/dependabot.yml` (weekly, Monday ~05:00 UTC).
2. `anthropics/claude-code-action` (already used in `claude.yml` / `claude-code-review.yml`,
   authenticated by `secrets.CLAUDE_CODE_OAUTH_TOKEN` — subscription, not metered API) **refuses
   bot actors** and is PR/issue-event-shaped. Consequences: behavioral evals can never run on a
   bot-opened drift PR, and a scheduled eval run would need a custom headless job, not that action.
3. No skill eval — structural or behavioral — runs in CI today. The behavioral evals for
   PR #304 were run locally by the author per the skill-creator workflow.
4. The NL-invocation revision (**implemented 2026-06-24**, #353/#433/#459/#460;
   `docs/plan-skill-nl-invocation.md`) removed `disable-model-invocation: true` from `/commit`
   and `/pr` and kept it on `/ship`. Any gate asserting that key must be per-skill, not uniform.
5. Upstream skill-creator bundles `SKILL.md`, `LICENSE.txt` (Apache-2.0), `agents/`, `assets/`,
   `eval-viewer/`, `references/`, and `scripts/` (all Python). Python is needed only when a human
   runs those scripts — never by CI or the app.

## Sequencing note (decided 2026-06-12; NL prereq satisfied 2026-06-24)

The NL-invocation revision was implemented between PR 1 and PR 2 as planned. PRs 2 and 3 target
the post-NL repo state, which is now live. **Verified post-NL state (don't re-derive):**

- **PR 2:** invocation-policy expectation table — `disable-model-invocation` absent on `/commit`
  and `/pr`; `true` on `/ship`. Eval counts on current `main`: commit=5, pr=8, ship=4 (all ≥3).
  Line counts: commit=198, pr=163, ship=121 (all well under 500). Re-derive
  `docs/spec-portable-ai-procedures.md` section/line citations at implementation time.
  **If PR #484 (`skill-nl-announce-affirmation`) has merged first:** counts become 8/9/6 (still
  ≥3); it touches `/ship` SKILL.md too, but body-only (delegation narration) — the
  `disable-model-invocation: true` frontmatter is unchanged, so the expectation table holds. It
  also edits spec §2, so re-deriving the citations matters more.
- **PR 3:** *(Superseded 2026-07-02 — PR 3 was redesigned to the scheduled drift workflow and
  the `/commit` Step 14 surfacing was dropped; see the PR 3 section and the decision log. The
  original Step 14 placement notes are retired with it.)*
- Both: `.claude/settings.json` is tracked (explicit `!.claude/settings.json` gitignore negation
  added by #353) — expected state, not a surprise to "fix".
- **Resolved issue (know it):** Thread 15 (`.scratch/skill-nl-invocation-review-roundtable.md`;
  issue #463) is **RESOLVED** — a two-merge same-session test (2026-06-26) showed the harness
  `ask` on `gh pr merge` **does** fire per-merge in **default** mode; PR #460 merged silently
  because that session was in **`auto` mode** (auto-approves), not a gate defect. Decision: **keep
  #459 (no Y/n)**; the default-mode `ask` is the confirmation. No `/ship` step-10 change needed.

---

## PR 1 — Vendor skill-creator + update script + acceptance evals

- Copy upstream `skills/skill-creator/` → `.claude/skills/skill-creator/` **verbatim**, including
  `LICENSE.txt`. Verbatim means skill-creator stays model-invokable; that is the deliberate
  choice — it is a non-side-effecting authoring tool, consistent with the two-tier risk model in
  the NL-invocation spec, and it avoids a patch-reapply step in every future refresh. (Cost: its
  description loads into every session, ~80 tokens.)
- `.claude/skills/skill-creator/UPSTREAM.md` — source URL, pinned commit SHA, vendored date, the
  refresh command. This file is the anti-drift anchor.
- `scripts/update-skill-creator.mjs` (Node, like the other `scripts/*.mjs`; Windows-clean):
  - default mode: sparse-clone upstream at `main` (or a passed SHA), sync the subdir, rewrite
    SHA + date in `UPSTREAM.md`, print a diff summary, **stop — no auto-commit**;
  - `--check` mode: compare the pinned SHA against
    `gh api "repos/anthropics/skills/commits?path=skills/skill-creator&per_page=1"`; exit 0 if
    current, else print the compare URL and exit non-zero. No file writes.
- `evals/skill-creator.evals.json` — three acceptance evals for the vendored copy (separate file:
  `evals/evals.json`'s own `$comment` scopes it to the three spec Skills):
  - **sc-1 load-and-invoke** (smoke): `/skill-creator` from a fresh clone starts its workflow and
    reaches its bundled `references/`/`agents/`/`assets/` with no missing-file errors.
  - **sc-2 scripts-run** (deterministic-ish, needs Python): run its bundled validator against an
    existing skill (e.g. `quick_validate.py` on `/commit`'s SKILL.md — confirm the real
    entrypoint/args at implementation); completes with a sensible result and exit code.
  - **sc-3 end-to-end authoring** (behavioral): create a trivial throwaway skill; output is
    well-formed (valid frontmatter; Invocation → Steps → Failure modes → `## Depends on`;
    ≤500 lines); delete the throwaway. Graded manually against that checklist until PR 2's gate
    exists, then "passes the PR 2 gate" becomes the criterion.
- Evals are **run locally and captured in the PR's Test Plan** (PR #304 precedent) — not a CI gate.
- Gitignore skill-creator's generated run artifacts (eval/benchmark output, `*.skill`), mirroring
  the `.team-cache.json` precedent; confirm exact paths during the build.
- Docs: `docs/doc-skill-creator.md` (path, pinned SHA, refresh command, Python prerequisite),
  one line in CLAUDE.md's AI Skills section, devjournal entry.
- Vercel: a `.claude/skills/**` merge triggers a production build (`ignoreCommand` skips only
  docs-only diffs). **Accepted** — a rare no-op build beats growing the skip predicate.

## PR 2 — Deterministic structural gate

> Tracked in #396. Reference that issue in the PR body.
> **Start from `main`** after this plan doc is current (PR #468 merged). `skill-nl-announce-affirmation` is independent — no sequencing constraint in either direction (see decision log 2026-06-26).

A Vitest test in the existing functional suite (so it reports through the already-required
`Lint & Functional Tests` check — no new workflow, no Python, no secrets). Scoped to an explicit
allowlist `{commit, pr, ship}`; skill-creator is upstream's artifact and is **not** held to our
skill contract. Assertions, each traceable to `docs/spec-portable-ai-procedures.md` (§2 L52–57,
§3 L84–115):

1. `.claude/skills/<name>/SKILL.md` exists for each of the three.
2. Frontmatter parses; `name` and `description` present; **invocation policy per skill from an
   expectation table in the test**, encoding the post-NL-revision state (commit/pr: key absent,
   ship: `true`) — verify against the implemented skills per the sequencing note above.
3. Frontmatter `name` matches the directory name.
4. Body sections in order: Invocation → Steps → Failure modes → `## Depends on`. Assert this as a
   **subsequence**, not adjacency — real skills interleave extra `##` sections (e.g. `Stash
   safety`, `Devjournal trigger list`) between the four required ones.
5. Body >500 lines → **warn only** (spec calls it a soft cap; visible in CI logs, never red).
6. `evals/evals.json` and `evals/skill-creator.evals.json`: every `skill_path` resolves; **≥3
   evals per skill**. Note the shape: `evals.json` has **one `skill_path` per skill** with the
   eval cases nested under it (3 `skill_path` entries, not one per eval) — count cases *within*
   each skill's group, don't count `skill_path` occurrences.

Deliberately *not* asserted (judgment/LLM territory, per spec L115): description quality,
`## Depends on` accuracy, "passes its eval set", self-hosting, eval realism.

## PR 3 — Scheduled drift check → tracking issue

> Tracked in #396; this is the closing PR (`Closes #396` in the body).
> **Scope decision (2026-07-02, reversing 2026-06-26):** PR 3 is the drift-detection workflow;
> the previously planned `/commit` Step 14 surfacing edit is **dropped**. Rationale: the Step 14
> hook fires only when `.claude/skills/skill-creator/**` is in a staged payload — i.e. on a
> refresh the human has *already decided to do* — so it structurally cannot detect upstream
> staleness (nothing in our tree changes when upstream moves), and its eval reminder duplicates
> what `update-skill-creator.mjs` and `UPSTREAM.md` already print at refresh time. The 2026-06-26
> "low ROI" deferral had bundled this cheap issue-based version with the expensive auto-PR (PAT)
> and behavioral-eval (custom headless job) variants; unbundled, the issue version needs only the
> default `GITHUB_TOKEN`.

- `.github/workflows/skill-creator-drift.yml`: monthly cron (05:07 UTC on the 1st) +
  `workflow_dispatch`; `permissions: contents: read, issues: write`; a `skill-creator-drift`
  concurrency group. Runs `node scripts/update-skill-creator.mjs --check`:
  - exit 0 (current) → silent success;
  - exit 2 (behind) → ensure the `skill-creator-drift` label exists, then open **one** tracking
    issue (compare URL + refresh instructions in the body) labeled `dependencies` +
    `skill-creator-drift` — mirroring Dependabot's `dependencies`+qualifier labeling. Dedup is
    by the qualifier label and **fail-closed**: if the dedup query errors, the run goes red
    rather than risk a duplicate;
  - any other exit → red (the check itself is broken; fix before trusting drift results).
- **Read-only toward the repo:** the workflow never syncs files or opens a PR. Refreshing stays
  the deliberate, human-run `update-skill-creator.mjs` + acceptance evals + reviewed `/commit`
  (the script itself prints those instructions).
- **Exit-2 path proven pre-merge (2026-07-02):** new workflows can't be dispatched before
  they exist on the default branch, so PR 3 carried a temporary throwaway commit (a
  `pull_request` trigger + the `UPSTREAM.md` pin rolled back to the prior upstream SHA) to force
  one real exit-2 run in CI — issue creation and label dedup verified live, then the test issue
  was closed and the throwaway commit dropped via force-with-lease before merge.

## Spike — prove the eval loop (tracked in #396; parallel to PRs 2–3)

**Problem.** `evals/evals.json` is inert: when someone edits a team skill's SKILL.md, there is no
way to check the edit didn't regress the skill except rereading the prompt. skill-creator's
with-skill vs. baseline eval loop is the mechanism that turns those committed evals into
executable regression protection — but PR 1 only proved load (sc-1), validate (sc-2), and
author (sc-3). The loop itself is unproven in this repo. Secondary payoff: the result is the
go/no-go input for PR 5 (behavioral evals in CI).

**Success criterion.** Not "the scripts ran" — it's: *a team-skill edit can be evaluated for
regression by the next maintainer, repeatably, from documented commands alone.* An honest
negative ("the loop isn't viable locally, here's the blocker and next action") is a valid
spike outcome and feeds PR 5's go/no-go.

**Facts established by code-reading (verify, don't re-derive):**

- There are **two distinct loops**. (a) *Trigger evals* — `scripts/run_eval.py` / `run_loop.py` /
  `improve_description.py`: standalone Python CLIs testing whether a skill's *description* causes
  Claude to invoke it; used for description optimization. (b) *Behavioral evals* — the
  with-skill vs. baseline comparison: orchestrated by the **skill-creator skill itself in a
  Claude session** (read its SKILL.md workflow), using the `agents/` subagent definitions
  (analyzer, comparator, grader), `aggregate_benchmark.py`, and `eval-viewer/` for review.
  **The spike's target is (b)**; (a) is secondary.
- **Auth:** the scripts shell out to `claude -p` (the Claude Code CLI, subscription auth — they
  strip the `CLAUDECODE` env var to allow nesting). No `ANTHROPIC_API_KEY` required.
- **Windows hazard:** `run_eval.py` uses `select.select()` on subprocess pipes — Unix-only
  (Windows `select` supports sockets only). Expect the trigger-eval CLIs to fail on native
  Windows; a worktree lane under WSL is the likely workaround. The behavioral loop may not share
  this problem (it is agent-orchestrated, not pipe-polling) — verify.
- **Schema divergence:** upstream expects a per-skill `evals/evals.json` *inside the skill
  directory* with integer `id` and an `expectations[]` list (see vendored
  `references/schemas.md`). Our repo-root `evals/evals.json` uses string ids, `eval_name`, and
  no `expectations`. The spike must map one skill's evals into upstream's shape **in a local
  scratch copy** — do not rewrite the committed `evals/evals.json` without review.

**Constraints for whoever runs it:**

- All three team skills mutate git state (branch, commit, push). Behavioral eval runs must be
  sandboxed — a throwaway repo or an isolated worktree lane with no push access — and eval
  prompts chosen so expected outcomes are observable without remote writes (refusal paths
  count). Suggested target skill: `/commit` (richest failure-mode surface).
- Each eval run is a full `claude -p` session: start with one skill and 1–2 evals before any
  benchmark aggregation. Watch cost/time and report it.
- Don't edit vendored files; don't commit generated output (note new output paths for
  `.gitignore` instead).

**Deliverables:** a "Running the eval loop" section in `docs/doc-skill-creator.md` (exact
commands, prerequisites, output locations); `.gitignore` additions for discovered output paths;
the #396 checkbox outcome (proved / blocked-with-next-action) plus a line in this doc's
decision log; cost/time observations for PR 5's go/no-go.

## PR 4 — Full Dependabot-style auto-PR drift (deferred)

Upgrade PR 3's workflow tail: drop `--check`, let the script sync files, open a PR when the tree
is dirty (compare URL in the body). Known requirements, mapped now so they aren't rediscovered:
PAT or GitHub App token (a default-`GITHUB_TOKEN` PR does not trigger `Lint & Functional Tests`,
so branch protection would block it); honest PR body (green = structural gate + repo build; the
human reviews the diff and runs the PR 1 evals per the refresh script's printed instructions).
Build when the issue-based cadence proves annoying, not before.

## PR 5 — Behavioral evals in CI, advisory/scheduled (deferred)

Reuse the existing `anthropics/claude-code-action` + `CLAUDE_CODE_OAUTH_TOKEN` plumbing. Scope to
human-authored PRs touching `.claude/skills/{commit,pr,ship}/**`, or a nightly schedule.
Non-required/advisory (like `e2e.yml`); results as a PR comment. Implementation caveats carried
from planning: (a) the action is PR-event-shaped — the scheduled variant needs a custom headless
Claude job; (b) the action refuses bot actors — this check can never gate PR 4's auto-drift PRs;
(c) whether skill-creator's subagent-spawning eval scripts run unmodified in headless CI is
unverified — spike before committing to this PR.

## Decision log

- 2026-07-02 — Blake: **PR 3 redesigned** from the `/commit` Step 14 eval-surfacing edit to a
  monthly scheduled drift check (`.github/workflows/skill-creator-drift.yml`: cron 05:07 UTC on
  the 1st + `workflow_dispatch`; `--check`; exit 2 → one tracking issue labeled `dependencies` +
  `skill-creator-drift`, label-deduped fail-closed; default `GITHUB_TOKEN`, no PAT). Reverses the
  2026-06-26 deferral: that call had bundled the cheap issue-based automation with the expensive
  auto-PR/behavioral variants, and the Step 14 hook couldn't serve the actual freshness goal — it
  fires only on refresh commits (never when upstream moves) and duplicates the refresh script's
  own printed eval instructions. PR 3 remains the closing PR for #396. Exit-2 path proven live
  pre-merge via a throwaway `pull_request`-trigger + pin-rollback commit, dropped before merge.
- 2026-07-02 — Blake: PR 2 (deterministic structural gate) implemented **on top of #484**, reversing the 2026-07-01 "independent, branch off `main`" call: `skill-nl-announce-affirmation` (#484) was merged first (`92984dc`) and the gate is written against the post-#484 repo state — eval counts 8/9/6 (commit/pr/ship), skill-creator 3, all ≥3. Gate lives at `tests/functional/skills/skill-contract.test.ts` in a **new `functional-skills` Vitest project** (its own home rather than folded into `functional-server`, so a skills contract test doesn't masquerade as a server test — and the `tests/functional/skills/` path is otherwise collected by no project and would silently not run). Runs in the required `Lint & Functional Tests` check. Allowlist `{commit, pr, ship}` only (skill-creator not held to our contract). Asserts: SKILL.md present; frontmatter parses with `name` + `description`; `name` == dir; per-skill invocation policy (commit/pr: `disable-model-invocation` absent, ship: `true`); body sections Invocation → Steps → Failure modes → `## Depends on` as a **subsequence**; >500 lines warns only; both eval JSONs' every `skill_path` resolves with ≥3 evals per skill. Spec citations re-derived post-#484: §2 L52–61, §3 L79–117.
- 2026-07-01 — Blake: Studied PR #484 (`skill-nl-announce-affirmation`, now open — announce at the routing decision + delegation narration + semantic over-trigger evals). Confirmed still independent of PRs 2/3 (verified assertion-by-assertion). Corrections folded into the Sequencing note and PR 2 assertions: post-#484 eval counts are 8/9/6 (not 5/8/4); #484 touches `/ship` SKILL.md body-only (frontmatter untouched); Step 14 shifts +4 (→~109). Also hardened two PR 2 assertions against the real file shapes: section-order is a subsequence check, and `evals.json` nests cases under one `skill_path` per skill (count within group).
- 2026-06-26 — Blake: Prereq correction — `skill-nl-announce-affirmation` is not required before PR 2 or PR 3. PR 2's assertions (key absence, section order, eval count ≥3) are insensitive to Step 0 announce content; eval ≥3 threshold is already satisfied (5/8/4). PR #468 is a procedural prerequisite (implementer should start from current `main`) but not a technical one.
- 2026-06-26 — Blake: Thread 15 resolved — two-merge same-session test (default mode) showed
  harness `ask` fires per-merge; #460 was `auto` mode. Y/n stays deleted (#459 stands). PR 3
  drift workflow deferred (low ROI for small team); PR 3 = `/commit` surfacing edit only.
- 2026-06-24 — Blake: NL-invocation prereq satisfied (#353/#433/#459/#460); PRs 2–3 unblocked.
  Post-NL state verified (see Sequencing note).
- 2026-06-12 — Blake: NL-invocation revision is implemented between PR 1 and PR 2; PRs 2–3
  target the post-NL repo state (see Sequencing note).
- 2026-06-12 — Blake: vendor over submodule/subtree/plugin; vendor-first sequencing (evals with
  the vendored skill in PR 1, gate second); 500-line cap is warn-only; ≥3 evals per skill
  asserted; drift starts as tracking issue, auto-PR deferred; behavioral CI evals deferred and
  advisory-only.
- 2026-06-12 — defaults set in drafting (veto in review): verbatim vendoring (model-invokable,
  no frontmatter patch); separate `evals/skill-creator.evals.json`; `/commit` surfaces rather
  than auto-runs evals; weekly drift cadence; Vercel `ignoreCommand` untouched; no cooldown
  guard in the update script v1 (human-reviewed refreshes make it redundant).
