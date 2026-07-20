# Strategy — Skill Evals

> Operational runbook for testing this repo's Claude Code Skills. Born in Phase 1 of the
> skill-evals baseline program and completed in Phase 5 — every section is authoritative
> now; no *(lands in Phase N)* placeholders remain. Design
> rationale, the full architecture, and the decision log live in
> [`docs/spec-skill-evals-baseline.md`](spec-skill-evals-baseline.md) — this doc is the
> "how do I actually run this" companion, not the "why did we build it this way" one.
>
> Built from the approved outline, `docs/spec-skill-evals-outline.md` (retired now that
> this doc exists — the outline's job was to get Blake's sign-off on structure before
> Phase 1 wrote content).

## 1. What this doc is

This is the repo-specific overlay on Anthropic's vendored `/skill-creator` skill
(`.claude/skills/skill-creator/`, pinned verbatim — see
[`docs/doc-skill-creator.md`](doc-skill-creator.md)). Skill-creator's stock workflow is
the front door for every skill task in this repo — creating a new skill, updating one,
running its evals, tuning its description. This doc doesn't replace any of that; it names
the one rule the stock workflow doesn't know about, and documents the thin additions
(fixtures, a sandbox harness, this doc, a CI shape gate) that make *execution* safe for
skills that mutate git/GitHub.

**The one rule, up front:** skill-eval prompts are never executed against the real repo —
any skill, any origin. Execution happens only inside harness-built sandboxes. Everything
else about a skill — reading it, editing its `SKILL.md`, writing or updating its evals,
reviewing an assertion list — is a plain file edit, safe anywhere, no different from any
other repo change.

**Not this doc's job:** how a fresh-session agent picks up a phase of the skill-evals
*build-out* program. That's the delegation protocol in spec Part III.1 plus the parent
GitHub issue's kickoff template. This doc is what those implementing agents (and everyone
else) consult *while working on a skill* — it has nothing to say about how the
infrastructure itself gets built.

## 2. Lifecycle map

Every skill task — new or existing — starts the same way: invoke `/skill-creator`, by
slash command or natural language ("help me build a skill for X", "make sure /commit
still passes its evals"). The table below maps skill-creator's stock steps to what this
repo's overlay adds at each one.

| Step | Front door (stock skill-creator) | What our overlay adds | Where to look next |
|---|---|---|---|
| Intake / interview | Asks about goal, triggers, expected outputs | **Safety-triage question:** *does this skill mutate git or GitHub state?* Decides whether execution evals need a sandbox at all — a skill that only reads files or talks to non-GitHub APIs never touches the harness. | §7 (reusable patterns) |
| Draft `SKILL.md` | Frontmatter + Invocation/Steps/Failure modes/Depends on body | Nothing — this step is 100% stock. If the skill is one of the three team skills (`/commit`/`/pr`/`/ship`), its contract is additionally checked by `tests/functional/skills/skill-contract.test.ts` on every CI run. | §5 |
| Write eval prompts | `evals/evals.json` inside the skill folder, upstream's own convention | **Schema:** for a mutating skill, each execution eval also needs `kind: execution`, a `fixture` name, a `human_script`, and an `expectations` list — the fields that make an eval *runnable* instead of just descriptive. | §3 |
| Run with-skill vs baseline | Executor subagents, in parallel, graded against expectations | **For a mutating skill:** executors run inside `make-sandbox`-built sandboxes, never against this repo. For a non-mutating skill: no change — stock parallel baseline runs. | §4, §6 |
| Review in the eval viewer | `generate_review.py` serves a browser page; human leaves feedback | Nothing — stock. The sandbox's transcript, gh call log, and git state are just more evidence the grader reads before writing `grading.json`. | §4 |
| Description-optimization loop | `run_loop.py` tunes the description for triggering accuracy | **Platform routing:** the loop's runner is Unix-only (a Windows `select()` crash). On Windows, hand off to a cloud/Cowork session with the committed Layer-C runner prompt instead of running it natively. | §8 |
| Ship | `/commit` → `/pr` (self-hosting: the Skills commit changes to themselves) | Nothing new — the eval-file shape is checked by the same CI gate as any other PR. | §11 |

## 3. Eval schema reference

Location: `.claude/skills/{commit,pr,ship}/evals/evals.json` — upstream's own documented
per-skill path (`evals/` inside the skill directory; see
`.claude/skills/skill-creator/references/schemas.md`). Any new skill's evals live at the
same relative path inside its own folder.

### Top-level shape

```json
{
  "$comment": "<execution notice — see below>",
  "skill_name": "commit",
  "skill_path": ".claude/skills/commit/SKILL.md",
  "spec_section": "docs/spec-portable-ai-procedures.md §4.1",
  "evals": [ /* eval objects, described below */ ]
}
```

`skill_name` / `skill_path` / `spec_section` are repo conventions layered on top of
upstream's bare `{skill_name, evals}` shape — kept for traceability back to the design
spec. `skill_path` is also what the contract test resolves to confirm the file isn't
orphaned.

### Eval object fields

| Field | Upstream or ours | Required on | Meaning |
|---|---|---|---|
| `id` | ours (upstream uses a bare integer) | every eval | Short, stable string id, e.g. `commit-2`, `ship-2a`. Pinned by the contract test for `kind: execution` evals — see §3's "what the contract test enforces" below. |
| `kind` | **ours (additive)** | every eval | `"execution"` or `"routing"` — no other value is valid. See the classification note below. |
| `eval_name` | upstream (`eval_name`/slug convention) | every eval | Descriptive slug, kept from the original acceptance-eval prose for readability. |
| `prompt` | upstream | every eval | The literal user turn (or turn sequence) that should invoke the skill. |
| `fixture` | **ours (additive)** | `kind: execution` only | Names the sandbox starting-state profile `make-sandbox --fixture <name>` builds (Phase 2). Its documented meaning is "requires a harness-built sandbox" — an agent that sees this field knows execution isn't safe to attempt directly. |
| `preconditions` | ours, retained from the original acceptance evals | every eval | Human-readable prose describing the starting world. **Kept verbatim on purpose:** this is the human-readable contract; the fixture profile is its executable implementation. If a fixture and its `preconditions` prose ever disagree, the profile is the bug, not the prose. |
| `human_script` | **ours (additive)** | `kind: execution` only, where an interactive checkpoint is reached | The scripted human reply (or replies) an executor gives at each approval/prompt point. Valid **only inside a marker-bearing sandbox** — see §4's scoping rule. |
| `expected_output` | upstream | every eval | Retained prose summary of correct behavior — the original acceptance-eval description. |
| `expectations` | upstream (`expectations[]`) | `kind: execution` (≥1 required); present but not required on `kind: routing` | Machine-gradeable assertion strings — what the native grader agent (`agents/grader.md`) checks against the transcript, gh call log, and sandbox git state. On routing evals these double as the manual-runbook checklist (§6) until Phase 8 automates them. |
| `notes` | ours (additive, optional) | occasional | Freeform cross-references — e.g. a wall-clock warning, a stub-sequencing requirement, a pointer to a related routing eval. Not read by any grader; purely for a human or agent skimming the file. |

### Execution vs. routing

- **`kind: execution`** — the prompt makes the skill actually do its work (stage files,
  open a PR, merge). Runs in a sandbox; graded by transcript + gh call log + git state.
- **`kind: routing`** — the eval tests *whether or how the skill fires* in a live session
  (a Step 0 gate, an announcement, a bare-"yes" affirmation, an over-trigger control). A
  subagent handed the skill directly can't test this — the thing under test is discovery,
  not execution — so these stay documented manual runbooks (§6) until the Phase-8 session
  runner automates them.

### The `$comment` execution notice

Every per-skill `evals.json` carries a top-level `$comment` restating the one rule from
§1 in the file itself — this is discovery layer 2 (§4): an agent that reaches for the
prompts without ever reading this doc or CLAUDE.md still gets the warning, because
reading `evals.json` to find the prompt is unavoidable.

### What the contract test enforces

`tests/functional/skills/skill-contract.test.ts` is the CI shape gate (the required
`Lint & Functional Tests` check, and `/commit`'s local `npm test` gate). For the
eval-artifact block it asserts, per skill:

- The per-skill `evals/evals.json` file exists and its `skill_path` resolves to that
  skill's `SKILL.md`.
- Every eval has a `kind` of `execution` or `routing` — nothing else.
- Every `kind: execution` eval carries a non-empty `fixture` and at least one
  `expectations` entry.
- The set of `kind: execution` eval `id`s exactly matches a **pinned list** taken from the
  approved conversion manifest (`docs/spec-skill-evals-manifest.md`) — so a
  skill-creator regeneration that silently drops or downgrades an eval fails loudly
  instead of shipping a quietly thinner suite (R1 hardening, spec II.5).
- Root `evals/evals.json` does not exist (it was deleted in Phase 1 — C14 rescope).

Failure messages are **prescriptive**: they name the offending file, the offending eval
`id`, the missing or wrong field, and point back here. If the pinned-ID assertion ever
fails on an *intentional, reviewed* eval-set change, update the pinned list in the test
alongside the manifest — don't loosen the assertion to make it pass.

**What this gate does NOT check:** eval *content* quality, whether an `expectations`
entry is well-written, or whether a fixture profile actually exists for a referenced
name (that's Phase 2's fixture-completeness check). Human review of the assertion lists
is the graded truth — the checkpoint every phase of this program names explicitly.

## 4. The safety model

**Trust boundary:** everything inside a marker-bearing sandbox is disposable and may be
mutated freely; everything outside it is the real repo, where eval execution is forbidden
and only the normal human-approved workflows (`/commit`, `/pr`, `/ship`) change state.

The vendored `SKILL.md` can't be edited, so the safe path has to reach agents in layers —
each one redundant with the next on purpose:

1. **CLAUDE.md** (always in context, every session, including natural-language entries):
   two sentences stating the one rule and pointing here.
2. **The eval files themselves** (just-in-time; covers subagents and odd contexts): an
   executing agent has to read `evals.json` to get the prompt, and the file's `$comment`
   plus each eval's `fixture` field carry the warning right where it's needed.
3. **The turnkey safe path:** `make-sandbox --fixture <name>` (`scripts/skill-evals/`)
   returns a ready sandbox path in one call — compliance is cheaper than improvising around
   it. See [`scripts/skill-evals/README.md`](../scripts/skill-evals/README.md).

**Invariant — "no marker, no run":** harness sandboxes contain a `.skill-eval-sandbox`
marker file. Eval execution (and `human_script` use) requires that marker to be present.
This turns "am I in the right place?" into a file-existence check, not a judgment call.

**`human_script` scoping rule:** scripted human replies are valid **only** inside a
marker-bearing sandbox. In the real repo, every approval checkpoint always comes from an
actual human — a `human_script` string is never a substitute for one outside a sandbox.

**Honest limit (spec C8):** these layers are prompt-level guidance, not hard enforcement.
The gates that fire regardless of what any agent does are the checked-in `ask` permission
rule on `gh pr merge` and the skills' own human-approval checkpoints (which stall rather
than push forward when no real human answers). The backstop stack — the marker rule,
the structural sandbox isolation, those hard gates, the CI shape gate, and plain git
recoverability — means a missed layer degrades to "recoverable and loud," never "silent
damage." Full backstop-stack detail: spec II.2c and II.5 (risk R3).

## 5. Layer A reality check

The vendored machinery's own structural validator, `quick_validate.py`, is **reference
only** in this repo — not the CI gate. Run it and you'll see:

```
$ python .claude/skills/skill-creator/scripts/quick_validate.py .claude/skills/commit
Skill is valid!

$ python .claude/skills/skill-creator/scripts/quick_validate.py .claude/skills/ship
Unexpected key(s) in SKILL.md frontmatter: disable-model-invocation
```

**The `/ship` failure is expected, not a defect.** `disable-model-invocation` is a real
Claude Code frontmatter key that makes `/ship` explicit-only (spec C7) — upstream's
validator predates it and carries a strict key allowlist that doesn't know about it. This
divergence is accepted and permanent until upstream's validator catches up.

**Why `skill-contract.test.ts` is the real gate:** it's this repo's own deterministic
Vitest check, encodes the same structural rules `quick_validate.py` would (frontmatter
present, section order, invocation-policy correctness) *plus* the eval-artifact shape from
§3, and it doesn't choke on `disable-model-invocation`. It's what CI actually runs and
what `/commit`'s local `npm test` gate actually checks.

If you're mid-authoring-flow and skill-creator's own tooling suggests running
`quick_validate.py` on `/ship`, don't read a nonzero exit there as something broken —
check `skill-contract.test.ts` instead.

## 6. Running evals — the one testing rule

**The rule:** when you change a skill (or refresh the vendored copy), you run the whole
test suite. There is only one way to run the tests — the full batch — and the PR
checklist shows whether you did it. No lighter per-skill variant exists in any doc or
template. Runs are human-triggered (a person, or their session's agent) — **never CI**;
the deterministic contract test (§3) is the only thing CI runs automatically. A
deliberate skip is an unchecked PR-template box with a stated reason, visible to
reviewers.

**The batch prompt** — [`scripts/skill-evals/prompts/batch-prompt.md`](../scripts/skill-evals/prompts/batch-prompt.md),
committed alongside the [executor-prompt template](../scripts/skill-evals/prompts/executor-prompt.md):
the single documented regression operation — "run the full skill eval suite" — runs every
`kind: execution` eval across all three skills, one sandbox per eval, executor pairs in
parallel batches, graded, aggregated per skill, and reported as one combined summary plus
viewer link. This is the *only* documented way to regression-test a skill change; there is
no lighter alternative.

### Running it — the exact commands (PowerShell and bash)

The batch prompt above is what you hand an orchestrating session; under the hood it — and
you, if you ever drive a single eval by hand — call the harness CLIs below. Every one is a
`node` invocation, identical on all platforms. Only two things are OS-specific: how you
*activate* a sandbox, and which `gh`-stub wrapper `PATH` resolves to (the harness sets that
up for you; you never pick).

PowerShell (Windows):

```powershell
# List fixture profiles; build a sandbox; or get the machine-readable manifest.
node scripts/skill-evals/make-sandbox.mjs --list
node scripts/skill-evals/make-sandbox.mjs --fixture feature-dirty-clean-payload
node scripts/skill-evals/make-sandbox.mjs --fixture feature-dirty-clean-payload --json

# Enter the sandbox (PATH -> stub gh, GH_TOKEN/GITHUB_TOKEN unset, cwd -> sandbox repo).
. <sandbox>\activate.ps1

# Full safety checklist; archive the raw evidence triad before teardown; tear down.
node scripts/skill-evals/selfcheck.mjs
node scripts/skill-evals/archive-evidence.mjs <sandboxDir> <eval-workspace>\outputs
node scripts/skill-evals/teardown-sandbox.mjs <sandboxDir>
node scripts/skill-evals/teardown-sandbox.mjs <sandboxDir> --archive <eval-workspace>\outputs
node scripts/skill-evals/teardown-sandbox.mjs --all
```

bash (Git Bash on Windows, macOS, Linux):

```bash
node scripts/skill-evals/make-sandbox.mjs --list
node scripts/skill-evals/make-sandbox.mjs --fixture feature-dirty-clean-payload
node scripts/skill-evals/make-sandbox.mjs --fixture feature-dirty-clean-payload --json

# Enter the sandbox.
source <sandbox>/activate.sh

node scripts/skill-evals/selfcheck.mjs
node scripts/skill-evals/archive-evidence.mjs <sandboxDir> <eval-workspace>/outputs
node scripts/skill-evals/teardown-sandbox.mjs <sandboxDir>
node scripts/skill-evals/teardown-sandbox.mjs <sandboxDir> --archive <eval-workspace>/outputs
node scripts/skill-evals/teardown-sandbox.mjs --all
```

Node ≥ 20 is the only prerequisite for the harness itself (enforced at runtime). Python 3 +
PyYAML + a logged-in `claude` CLI are needed **only** for Layer C (§8) — never for the
execution batch. Sandboxes are created under the OS temp dir (override with
`SKILL_EVAL_SANDBOX_ROOT` or `--root`), and `make-sandbox` refuses any root inside the real
repo, so you can never build one over your own checkout. Harness-internals reference:
[`scripts/skill-evals/README.md`](../scripts/skill-evals/README.md).

### Evidence archiving and executor-independent grading

Every eval run archives the **raw evidence triad** into the eval's workspace `outputs/` dir
**before the sandbox is torn down** — this is harness behavior (`archive-evidence.mjs` /
`teardown-sandbox.mjs --archive`), not a request an agent may skip. It writes:

- `gh-calls.log` — the primary grading evidence (what the skill asked GitHub to do).
- `git-state.txt` — a raw dump of the sandbox repo + bare origin (status, log, branches,
  reflog, staged/unstaged diffs).
- `gh-stub-state.json` — the stub's durable state, including any `gh pr merge` records.
- `archive-manifest.json` — provenance and which legs were captured.

The grader reads those **raw files** (plus the executor's transcript), never a prose
*summary* of them. This makes the grade **executor-independent** — reproducible by a third
party who never watched the run. (This is a hard rule as of the Phase-3 gate-close, #511:
that iteration archived nothing, so its CLEAN verdicts rested on self-graded orchestrator
prose and could not be independently corroborated — the audit's F-A finding.)

### The merge-discrimination rule (`gh pr merge`-adjacent assertions)

`.claude/settings.json` ships an `ask` permission rule on `gh pr merge *` (and the
PowerShell equivalent). It fires at the Claude Code permission layer — **before** the
sandbox `gh` stub ever runs — so in an eval session a `gh pr merge` command is frequently
intercepted and never reaches the stub to be logged. Consequently:

- An **empty `gh-calls.log` is not proof that no merge was attempted.** A `/ship` that
  wrongly merges would have its merge intercepted too, leaving the log just as empty as a
  correct abort — a false PASS (the Phase-3 audit's F-B finding: the ship red control's
  designated "no `gh pr merge` in the log" assertion passed *vacuously* against a mutant
  that did attempt the merge).
- A **missing log entry is not proof a correct merge failed.** Whether the `ask` rule
  auto-clears is environment-stochastic, not skill behavior (F-B: ship-3's positive merge
  assertion passed on one arm and failed the byte-identical other arm).

**The rule:** grade every merge-adjacent assertion from the **transcript's tool-call
record** — an attempted `gh pr merge` appears there whether or not the `ask` rule lets it
through, so it is the authoritative signal for whether the skill *attempted* the merge.
Corroborate it, where the environment let the call reach the stub, with a `pr merge` entry
in `gh-calls.log` and/or a merge record in `gh-stub-state.json`. **Never PASS a
merge-negative on an empty log alone.** This is the same discipline the liveness rule
applies to negative assertions, extended to cover interception *upstream of the stub*, not
just a PATH misroute. (The permanent close would be sandbox-scoped merge instrumentation the
`ask` rule can't preempt; until then, the transcript is the load-bearing leg — the ship
merge expectations spell this out inline.)

**Routing evals stay manual at baseline.** The nine `kind: routing` evals (listed below)
are not part of the automated batch — a subagent handed the skill can't test whether it
*fires*, only what it does once invoked. Until the Phase-8 session runner exists, run them
by hand: open a fresh session with no prior context, issue the query exactly as written,
and check the response against the eval's `expectations` list.

| Eval | Query | What to watch for |
|---|---|---|
| `commit-4` | "let's commit this" | `Using /commit` announcement, then Step 0 |
| `commit-5` | three sub-queries (see below) | Step 0 skipped in all three, for different reasons |
| `commit-6` | assistant offers to commit → bare "yes" | Skill fires on the bare affirmation |
| `commit-7` | assistant offers to *explain* /commit → bare "yes" | Skill does NOT fire (negative control) |
| `commit-8` | "does the commit message follow Conventional Commits?" | Skill does NOT fire (over-trigger control) |
| `pr-8` | "open a PR for this branch" | `Using /pr` announcement, then Step 0 |
| `pr-9` | assistant offers to open a PR → bare "yes" | Skill fires on the bare affirmation |
| `ship-4` | "ship it" | `/ship` does NOT fire (explicit-only); direct `gh pr merge` still asks |
| `ship-5` | "remind me what /ship does" | Skill explains, does NOT ship (over-trigger control) |

**`commit-5`'s three sub-queries** (one routing eval, three manual runs — the splitting
rule applies to execution evals only, so this stays one entry whose runbook enumerates the
sub-scenarios): (a) type `/commit` explicitly — Step 0 skips because it's a verified slash
entry; (b) let `/pr` or `/ship` delegate into `/commit` — Step 0 skips because the fresh
delegation marker is present; (c) create
`.claude/skip-nl-confirm-commit-pr.local` and invoke by natural language — Step 0 skips
because of the opt-out file, but the `Using /commit` announcement still fires.

**`ship-6`'s live-announcement nuance:** `ship-6` itself is `kind: execution` (the
delegation *mechanics* — markers, handoff lines, Step-0 suppression — are
sandbox-testable). But the live, real-session *feel* of watching `/ship` → `/pr` →
`/commit` announce each hop is worth checking by hand alongside `ship-4`/`ship-5`'s
manual runs — same session, same "does this read right to a human watching it" check.

**`ship-2a` is the batch's long pole** (~10 minutes wall clock — it waits 5 minutes,
picks `wait+5`, waits another 5, then aborts). Schedule it in the first parallel wave so
its wait overlaps the rest of the batch rather than adding serially to the total run time.

## 7. Reusable patterns for your own skill

Written for a future skill author — human or agent — building *any* skill (not just
`/commit`/`/pr`/`/ship`) whose evals need git/GitHub state to check against. The harness
that makes these patterns reusable lives at
[`scripts/skill-evals/`](../scripts/skill-evals/README.md).

**The core pattern:** if your skill's evals need "a mock repo with open PRs and commits to
check against" — the `/handoff` pain point that motivated writing this down — you don't
need to invent your own test rig. Reuse this program's three pieces:

1. **A fixture profile** — a named starting-state (a temp git repo pre-populated with
   whatever commits/branches/PRs your skill's evals need). Fixtures are plain data, not
   code (spec C13) — adding a new one is usually just naming a new starting state, not
   touching the harness.
2. **The logging `gh` stub** — a `PATH`-shadowing shim that answers `gh` subcommands from
   fixture JSON and logs every call. If your skill only calls `gh` subcommands the three
   team skills already exercise, the stub's existing surface likely covers you; anything
   outside the stubbed surface hard-fails by design (default-deny) rather than falling
   through to the real `gh`.
3. **`make-sandbox --fixture <name>`** — builds the sandbox, applies your fixture, writes
   the marker. Your eval's `human_script` and `expectations` are the only parts specific
   to your skill.

**Worked example:** your skill's evals need a repo with two open PRs, one with a stale
review request. Copy an existing fixture profile close to that shape — profiles are plain
data in [`scripts/skill-evals/lib/fixtures.mjs`](../scripts/skill-evals/lib/fixtures.mjs)
(the [README](../scripts/skill-evals/README.md) documents the profile fields) — adjust the
PR list and gh-stub response data, name it something like `two-open-prs-one-stale-review`,
and reference it from your eval's `fixture` field. A few lines of data change; nothing about
the harness itself does. If your skill calls a `gh` subcommand the three team skills don't,
add a handler to the stub's traced surface rather than loosening its default-deny.

**Where the team boundary sits:** these requirements (schema, full-suite obligation,
contract-test coverage) attach the moment a skill is committed to this repo's
`.claude/skills/` — regardless of where it came from (written here, copied from a
teammate, imported from GitHub). A skill installed only at the user level, or sitting
uncommitted locally, can use the stock flow and this harness freely — it's just not
*governed* by these obligations until it's committed.

## 8. Platform routing (Layer C)

Layer C is the vendored `/skill-creator` **description-optimization loop** (`run_loop.py`,
which imports `run_eval.py`): it tunes a skill's frontmatter `description` for triggering
accuracy against a committed trigger-eval set. It is the one piece of vendored machinery
that **can't run on native Windows** — `run_eval.py` calls `select.select()` on a
subprocess pipe, which raises `OSError [WinError 10093]` on Windows (spec C2, re-verified
2026-07-19). Layer C never touches `gh`, so the cloud-no-`gh` gap does not apply.

**Scope:** only `/commit` and `/pr` — the two natural-language-invocable skills. `/ship` is
explicit-only (`disable-model-invocation: true`), so description optimization does not apply
to it; its should-NOT-trigger behavior is covered by routing evals ship-4 / ship-5.

### Trigger-eval sets

Location: `.claude/skills/{commit,pr}/evals/trigger-evals.json`. Shape is upstream's own —
a **bare JSON array** consumed directly by `run_loop.py` (`SKILL.md` → "Description
Optimization"):

```json
[
  { "query": "open a PR for this branch", "should_trigger": true },
  { "query": "ship it", "should_trigger": false }
]
```

Each object needs `query` (string) and `should_trigger` (bool); ~20 per skill (10
should-trigger phrasings + 10 tricky **near-miss** negatives — queries that share keywords
with the skill but need something else). An additive **`note`** field per object is allowed
for maintainer/author traceability — `run_loop.py` reads only `query`/`should_trigger` and
ignores extra keys, and `note` never reaches the description-improver (it sees only the
graded results). This is a different file and shape from a skill's `evals/evals.json`
(§3); the CI contract test gates `evals.json`, not `trigger-evals.json`.

### Where it runs

| Platform | How Layer C runs |
|---|---|
| **macOS / Linux** | Run the documented commands **directly** (needs python3 + PyYAML + a logged-in `claude` CLI). |
| **Cloud Claude Code session** | Linux, so the crash vanishes. The runner prompt's Step 0 is the **C5 smoke** — a 30-second nested `claude -p` check that the cloud sandbox supports it (spec C5). |
| **Cowork** | Works per the vendored SKILL.md's Cowork section. |
| **Windows** | **Never natively.** Hand the committed runner prompt to a cloud/Cowork session (or a Mac/Linux teammate) and take back the reported `best_description`. |

The committed copy-paste driver is
[`scripts/skill-evals/prompts/layer-c-runner-prompt.md`](../scripts/skill-evals/prompts/layer-c-runner-prompt.md).
It runs the C5 smoke first, then `run_loop.py` per skill (holdout 0.4 → stratified
train/test split; `runs-per-query 3` → probabilistic trigger *rates*), archives the raw
results before any teardown, and **reports** `best_description` + before/after train/test
scores. It does **not** commit anything.

**Current posture (R6, as of 2026-07-20):** the true cloud C5 smoke and the Layer-C
optimization run have **not yet been executed in a genuine cloud/Cowork Linux session** —
attempts to date fell back to Windows hosts, which cannot run `run_eval.py` (the `select()`
crash). What *is* confirmed, on native Windows, is only the diagnostics: nested `claude -p`
returns cleanly (the `CLAUDECODE` nesting guard is not a blocker), and the `select()`-on-pipe
probe reproduces `WinError 10093` (C2 re-verified). So the description-optimization leg stays
**deferred** until someone runs the committed runner prompt above in a real cloud or Cowork
session. Layer C is a *Should*, so this posture does not block baseline completion. Tracked on
the Phase-4 issue (#512, R6 flag).

### Landing a description change

The loop is **report-only**. A change to a real skill's `description` is a one-line SKILL.md
frontmatter edit that lands back on the author's machine through the normal `/commit` → `/pr`
flow **with maintainer sign-off** — the same guarded review as any skill change. **"Retain
the current description" is an allowed, common outcome** (prefer the candidate only when it
beats the current on the held-out **test** score, not just train — that's the overfitting
guard). The current `/commit` and `/pr` descriptions were already hand-tuned during the
NL-invocation work, so a no-change result is expected and fine.

## 9. Platform validation prompt

A committed copy-paste prompt that runs one designated eval end-to-end on a given platform,
emits a small pass/fail + environment artifact, and **auto-posts it to a named GitHub
issue** (`gh issue comment <ISSUE> --body-file …`; if `gh` isn't authenticated it prints the
artifact for the runner to paste). It lives at
[`scripts/skill-evals/prompts/platform-validation-prompt.md`](../scripts/skill-evals/prompts/platform-validation-prompt.md).

- **Designated eval:** `commit-1` (fixture `feature-dirty-clean-payload`) — fast, no long
  waits, no complex gh sequencing.
- **Issue number:** filled per run via the `<ISSUE>` placeholder (the Phase-2 macOS smoke
  posts to the phase issue).
- **The one real-`gh` touch:** posting the artifact comment — a human-run action, not an
  eval execution against the real repo.
- **Retention:** kept past baseline for re-validation when the harness shell wrappers or
  path handling change, and for onboarding a teammate on a new OS; revisit keep/slim/retire
  after the first macOS run.

## 10. Real-repo exception lane (spec C12)

Everything above keeps eval execution inside disposable sandboxes. This is the **single
sanctioned exception** to "never against the real repo" — plus the discipline that keeps it
from drifting into "whenever convenient."

**What it is:** a rare, **human-run, human-attended, AI-guided end-to-end smoke test** of the
actual plumbing — a real skill (`/commit` or `/pr`) doing its real job against real `gh`, on
a throwaway change — for confidence the whole path works where a sandbox can't prove it.
Reach for it only when the thing you need to check *is* the real boundary the sandbox fakes
away: e.g. after changing how the harness or a skill shells out to `gh`, or validating the
real `/commit` → `/pr` path once on a brand-new platform before you trust the sandbox
surrogate there.

**What it is NOT:** it is **not** running an eval *prompt* against the real repo — that stays
forbidden, full stop, no exception. The line: a sandbox eval feeds a skill a scripted
`prompt` + `human_script` to *grade* it; this smoke is *you*, a live human, driving the skill
on genuinely disposable work and approving each checkpoint yourself. It is also **never a
substitute** for a sandbox batch run — if the batch can cover it, the batch is the answer.

**Two gates, both required before you run:**

1. **Recorded justification.** Before running, write — on the PR or issue that motivates it —
   one or two sentences naming *why a sandbox can't answer this* and *what you'll exercise*.
   No recorded justification, no run. (This is spec C12's guard against "occasional" drifting
   into "whenever convenient.")
2. **Cleanup owed, declared up front.** You own reverting every trace before you walk away.
   Paste the cleanup checklist (below) into the same PR/issue *before* you start, and tick it
   when done.

**The runbook:**

1. Record the justification (gate 1) on the driving PR/issue.
2. Create a throwaway scratch branch off `main` — **never run this on `main`** (PowerShell
   and bash are identical here):
   ```
   git switch -c smoke/skill-eval-<short-desc>
   ```
3. Make a trivial, obviously-disposable change (e.g. a one-line edit to a scratch file you
   will delete) — never real work you'd want to keep, so cleanup stays unambiguous.
4. Drive the skill exactly as a normal human-approved run — invoke `/commit` or `/pr` and
   answer every approval checkpoint **yourself** (no `human_script`: that string is valid only
   inside a marker-bearing sandbox — §4). Watch that the real `gh` calls and the real
   push/PR behave.
5. Note the result on the driving PR/issue.
6. **Clean up (owed) — the checklist you pasted up front:**
   - [ ] Close and delete any PR the smoke opened (`gh pr close <N> --delete-branch`).
   - [ ] Delete the scratch branch locally and on the remote (`git switch main`, then
     `git branch -D smoke/…` and `git push origin --delete smoke/…`).
   - [ ] Revert or drop any commit that reached `main` (this smoke should never target
     `main`, but audit anyway).
   - [ ] Delete any throwaway issue/PR comment the smoke posted.
   - [ ] Confirm `git status` is clean and `git branch` shows no stray `smoke/…` branch.
   - [ ] Tick this checklist on the driving PR/issue.

If any cleanup step can't be completed, say so on the driving PR/issue and flag a maintainer —
an un-cleaned smoke is a loose end someone must close, not something to leave silent.

## 11. Maintenance rules

- **Edit skills in place; never delete-and-recreate.** Under the per-skill eval layout, a
  folder delete-and-recreate loses that skill's evals (spec II.5, risk R2). Git recovers
  either way, but editing in place avoids the churn.
- **The vendored `.claude/skills/skill-creator/` directory is 100% stock.** Never
  hand-edit it. Refresh via the monthly drift workflow (`node
  scripts/update-skill-creator.mjs --check`) — see `docs/doc-skill-creator.md`.
- **Run artifacts are gitignored, not committed.** Eval workspaces live under
  `.claude/skills/<name>-workspace/` (upstream's own default location) and are covered by
  the repo's `.gitignore`. Nothing about a normal eval run should ever show up in `git
  status`.
- **Where decisions live vs. where state lives:** design decisions and their rationale are
  the spec's Part IV ledger (`docs/spec-skill-evals-baseline.md`); the *current state* of
  the build-out program (which phase is active, what's blocked) lives on the parent
  GitHub tracking issue, not in any committed file.
