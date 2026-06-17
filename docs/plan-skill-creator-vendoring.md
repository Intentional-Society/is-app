# Plan: Vendor `skill-creator` + Drift Management + Skill Eval Gates

**Status:** Proposed 2026-06-12 (Blake, drafted with Claude). Not yet implemented.
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
(1), deterministic structural gate (2), light drift detection + local eval surfacing (3), then two
deferred upgrades (4, 5).

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
  how `main` stalls. Behavioral evals are local (PR 3) and later advisory-only (PR 5).
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
4. The NL-invocation revision (`.scratch/skill-nl-invocation-bootstrap.md`, decided 2026-06-12,
   unimplemented) will remove `disable-model-invocation: true` from `/commit` and `/pr` and keep
   it on `/ship`. Any gate asserting that key must be per-skill, not uniform.
5. Upstream skill-creator bundles `SKILL.md`, `LICENSE.txt` (Apache-2.0), `agents/`, `assets/`,
   `eval-viewer/`, `references/`, and `scripts/` (all Python). Python is needed only when a human
   runs those scripts — never by CI or the app.

## Sequencing note (decided 2026-06-12)

The NL-invocation revision (`.scratch/skill-nl-invocation-bootstrap.md`) is implemented **between
PR 1 and PR 2**. PRs 2 and 3 are therefore written against the post-NL state of the repo, and
their implementer must first check how that revision actually landed:

- **PR 2:** the invocation-policy expectation table is read from the *implemented* skills —
  expected: `disable-model-invocation` absent on `/commit` and `/pr`, `true` on `/ship`. The
  spec will have been revised to v1.1; re-derive the section/line citations below from the
  revised `docs/spec-portable-ai-procedures.md` rather than trusting this doc's line numbers.
- **PR 3:** the `/commit` body will have gained a Step 0 (NL intent gate) and a new description;
  read the current body before editing, place the skill-creator surfacing in the approval-block
  step (not near Step 0), and confirm 500-line headroom.
- Both: the NL work checks in `.claude/settings.json` (with a `!.claude/settings.json` gitignore
  negation) — expected state, not a surprise to "fix".

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
4. Body sections in order: Invocation → Steps → Failure modes → `## Depends on`.
5. Body >500 lines → **warn only** (spec calls it a soft cap; visible in CI logs, never red).
6. `evals/evals.json` and `evals/skill-creator.evals.json`: every `skill_path` resolves; **≥3
   evals per skill**.

Deliberately *not* asserted (judgment/LLM territory, per spec L115): description quality,
`## Depends on` accuracy, "passes its eval set", self-hosting, eval realism.

## PR 3 — Light drift detection + local eval surfacing

> Tracked in #396. Reference that issue in the PR body.

- `.github/workflows/skill-creator-drift.yml`: **weekly** schedule (matches the Dependabot
  rhythm) + `workflow_dispatch`. Runs `node scripts/update-skill-creator.mjs --check`; on
  non-zero, opens **or updates** a single tracking issue with the compare URL and the refresh
  command. Default `GITHUB_TOKEN` suffices (issues only — no PR, no token gymnastics).
- `/commit` SKILL.md: when the staged payload touches `.claude/skills/skill-creator/**`, surface
  in the approval block: "skill-creator changed — run the `evals/skill-creator.evals.json`
  acceptance evals and capture results in the Test Plan." Same pattern as the existing
  schema-touch detection (spec §4.1 step 9). **Surface-and-capture only** — `/commit` does not
  auto-run Python or behavioral evals in its critical path. `/commit` is the right stage: it is
  the earliest gate, already runs `npm test` (which fires PR 2's gate), and its commit-message
  convention already requires a Test Plan. `/pr` and `/ship` move already-committed work.

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
human reviews the diff and runs the PR 1 evals per PR 3's `/commit` surfacing). Build when the
issue-based cadence proves annoying, not before.

## PR 5 — Behavioral evals in CI, advisory/scheduled (deferred)

Reuse the existing `anthropics/claude-code-action` + `CLAUDE_CODE_OAUTH_TOKEN` plumbing. Scope to
human-authored PRs touching `.claude/skills/{commit,pr,ship}/**`, or a nightly schedule.
Non-required/advisory (like `e2e.yml`); results as a PR comment. Implementation caveats carried
from planning: (a) the action is PR-event-shaped — the scheduled variant needs a custom headless
Claude job; (b) the action refuses bot actors — this check can never gate PR 4's auto-drift PRs;
(c) whether skill-creator's subagent-spawning eval scripts run unmodified in headless CI is
unverified — spike before committing to this PR.

## Decision log

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
