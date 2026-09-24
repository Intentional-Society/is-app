# Design — Skill-evals harness

Status: as-built 2026-09-18, against `scripts/skill-evals/` at commit `7b8f157`. Tracks issue #507.
Supersedes `docs/old-archive/spec-skill-evals-baseline.md`.

**Read this if you need to understand, fix or extend the machinery that tests this repo's Claude
Code skills (`/commit`, `/pr`, `/ship`): how it is built, why it is built that way, and what is
known to be missing.** This is **not** the front door to the skills work as a whole. If you are
new, start at the "Which doc do I want?" table at the top of
[`strategy-skill-evals.md`](strategy-skill-evals.md). If you only need to *run* evals, read that
runbook instead.

After reading this you should be able to find the module that owns any harness behavior, explain
why an eval run cannot reach real GitHub, and tell whether a given piece of work is settled, open,
or deliberately not built.

*As-built* means this doc describes the harness that exists, not the harness that was planned; the
plan is the archived predecessor named above. It sits below `strategy-skill-evals.md` (which tells
you how to *run* the harness) and above the code. The program that built it is finished except for
two items, both listed in §10. The 2026-09-18 scope decisions behind this rewrite are recorded as
comments on issue #507. Blake is the repo's maintainer and the author of the three skills; until
this program he was the only person who could verify a skill change.

## 0. How to read this

Primary reader: an AI agent picking up harness work cold. A human who just needs the shape can read
§1, §2, §5 and §6 and stop — §5 is what lets you trust running an eval at all, and §6 is the
judgment you need to review someone's eval change. §4's two flow diagrams show the machinery; §10
and §11 are for auditing state and evidence. (The runbook carries no rationale, so §5 and §6 are the
only account of *why* anywhere.)

### What is in each section

| § | Answers |
|---|---|
| 1 | Why this exists, and what "done" was supposed to mean |
| 2 | How it got here — four stages of work, and the one inherited fact that shaped everything |
| 3 | The organizing rule, and the fourteen constraints the design had to work around |
| 4 | What the code is: every file, what calls it, and the two end-to-end flows |
| 5 | What keeps an eval run away from the real repo — and what does not |
| 6 | Why it is shaped this way, including the rules for writing an assertion worth keeping |
| 7 | Three worked scenarios: new skill, changed skill, a teammate arriving cold |
| 8 | The one thing designed but deliberately not built |
| 9 | The decision ledger and the live risk register |
| 10 | What is broken, thin or unfinished — and what to update here when each lands |
| 11 | The measured evidence, re-derived from the raw run artifacts |
| 12 | How to decode an id you found in an old comment |

### Notation

**`§`** means "section". **`§4`** is section 4 of *this* document. **`strategy §6`** or
**`strategy-skill-evals.md` §6** is section 6 of that document; where a cross-document reference
matters, the section's title is given too, because these links land at the top of the file and you
would otherwise hunt.

The doc uses several id schemes. This is the key; §12 resolves each one in full.

| Scheme | What it numbers | Defined in |
|---|---|---|
| `C1`–`C14` | **Constraints** — facts the design had to work around | §3 |
| `R1`–`R8` | **Risks**, each with its status today | §9 |
| `DP1`–`DP4` | **Design points** — the program's numbered architecture decisions | §9 |
| `E1`–`E4` | **Escalations** — the four questions the 2026-07-19 peer review put to the maintainer | §9 |
| `F-A`, `F-B` | **Findings** from the audit at the end of Phase 3 | §12 |
| `II.2c`, `IV.1`, … | Section numbers of the **archived predecessor spec**, still cited in code comments | §12 |
| "ruling N" | A numbered **maintainer decision** from a review session, cited in code comments | §12 |
| Phase 0–8 | The nine **stages of the program** that built this, tracked as issues #508–#516 | §12 |
| `G1` / `G2` | Two generations of the **routing grader** (§11's counts table) | §11, §12 |
| `A1`–`A4` | This doc's shorthand for an eval's **expectations in file order** — a display convention, not ids, so an A-number is only meaningful against the current text of that eval | §10, §12 |
| `commit-5a`, `pr-7`, `ship-2a` | **Eval ids**: skill name + number; a letter suffix marks a sub-scenario of one original eval | the roster in §4 |
| `#nnn` | A **GitHub issue or PR** in this repo | §12 |
| `7b8f157` | A **git commit** in this repo, cited to pin a claim to a point in history | — |

**Bold ids in tables** mark the ones cited by bare number somewhere outside this doc — in code
comments, tests, or a sibling doc. Unbolded ids are referenced only from inside this document.

### Task → where to go

| Your task | Read |
|---|---|
| Run the eval suite; add an eval; look up the schema | [`strategy-skill-evals.md`](strategy-skill-evals.md) §3, §6 — not this doc |
| Understand *why* the harness is shaped this way | §6 here |
| Fix a harness bug; find which module owns a behavior | §4 here, then [`../scripts/skill-evals/README.md`](../scripts/skill-evals/README.md) |
| Understand what stops an eval run reaching the real repo | §5 here, then `strategy-skill-evals.md` §4 |
| Add a fixture profile | §4's fixture entry here, then `../scripts/skill-evals/lib/fixtures.mjs` |
| Write or retire an assertion | §6's assertion-design rules here |
| A routing eval is flaky | §6's assertion-design rules here — "sort variance by locus" and the #527/#528 worked example — then §11 for the measured counts, and §10's "No procedure for changing a routing assertion" for what was open and how it closed |
| The `gh` stub rejected a command | §4.3's subcommand table here (default-deny is deliberate), then [`../scripts/skill-evals/README.md`](../scripts/skill-evals/README.md)'s gh-stub surface table |
| Is this eval able to fail at all? | §11's red controls, then §6's assertion-design rules |
| Find out what the evals actually test | the **eval roster** at the head of §4 — all 25, one line each |
| Find out what is known-broken or unfinished | §10 here |
| Find a number (pass rates, run counts) | §11 here |
| Decode an id you found in a comment | the **Notation** key above, then §12 for the full resolution |
| Change a skill's *behavior* | [`spec-portable-ai-procedures.md`](spec-portable-ai-procedures.md) §4 |

### The siblings, one line each

| Doc | Owns |
|---|---|
| [`strategy-skill-evals.md`](strategy-skill-evals.md) | The operational runbook: what it calls "the one rule" (the safety rule), the eval schema, the exact run commands, the merge-discrimination rule, the manual routing runbook, maintenance rules. Highest fan-in of the family. |
| [`spec-skill-evals-manifest.md`](spec-skill-evals-manifest.md) | The pinned, id-by-id mapping from the 23 original acceptance evals to today's 25 entries. Enforced by the contract test. |
| [`doc-skill-creator.md`](doc-skill-creator.md) | Operating the vendored `/skill-creator` copy: the pin, the refresh command, the Python prerequisite, the `quick_validate.py` divergence. |
| [`spec-portable-ai-procedures.md`](spec-portable-ai-procedures.md) | What `/commit`, `/pr`, `/ship` each *do*, step by step. The behavior the evals test. |
| [`plan-skill-nl-invocation.md`](plan-skill-nl-invocation.md) | The natural-language invocation mechanism: Step 0, the delegation hand-off file and its 30s lease, the announcement contract. |
| [`plan-skill-creator-vendoring.md`](plan-skill-creator-vendoring.md) | Why the skill-creator copy is vendored rather than submoduled, and the PR sequence that delivered it. |
| [`strategy-security.md`](strategy-security.md) | The checked-in `ask` rule on `gh pr merge` — its precedence and its stated limits. |
| [`../scripts/skill-evals/README.md`](../scripts/skill-evals/README.md) | Harness CLI surface, sandbox directory layout, the gh-stub surface table, the selfcheck item list. |
| [`../scripts/skill-evals/routing/README.md`](../scripts/skill-evals/routing/README.md) | The routing runner's CLI, its workspace tree, the headless adaptations. |
| [`devjournal.md`](devjournal.md) | Chronology and issue numbers. |

### Terminology — one term per concept, held throughout

**Skip this on a first read; come back when a word bites.** It is an index, not a chapter.

Three groups: the words Claude Code brings with it, the words this harness invented, and four words
that used to mean more than one thing.

#### Claude Code vocabulary — inherited, and what the harness tests

You need these to follow §2, §5 and §6. Each is sourced from a file in this repo; follow the named
file for the full rules.

- **Skill / `SKILL.md`** — a folder under `.claude/skills/` holding a procedure Claude Code can
  follow. `SKILL.md` is its instructions, opening with a frontmatter block that declares its `name`
  and `description`. The three under test here are `/commit`, `/pr` and `/ship`
  ([`spec-portable-ai-procedures.md`](spec-portable-ai-procedures.md) §3).
- **Slash vs natural-language (NL) invocation** — a skill fires either because a human typed
  `/commit`, or because the model recognised the intent in ordinary words ("commit this"). A typed
  slash is expanded by the CLI's own parser and injected directly; an NL invocation goes through the
  `Skill` tool. That difference is the whole of `commit-5a` (§6).
- **`disable-model-invocation`** — the frontmatter key that makes a skill **explicit-only**: it can
  be typed but never fired by the model. `/ship` carries it; `/commit` and `/pr` do not. The
  contract test pins exactly that (§4.8).
- **Step 0** — the intent-confirmation step `/commit` and `/pr` run when they were invoked by
  natural language rather than by a typed slash. It asks, in `/commit`'s own words, "Run `/commit`
  with: *[detected context]*?" before touching git. Three things skip it: a typed slash, a fresh
  delegation hand-off file, and the opt-out file `.claude/skip-nl-confirm-commit-pr.local`
  (`.claude/skills/commit/SKILL.md` Step 0).
- **The announcement** — the line a skill prints as it routes, `Using /commit` or `Using /pr`, so
  the human can see which skill fired. The opt-out file suppresses the Step-0 *confirmation* but
  never the announcement; only delegation does (CLAUDE.md, "AI Skills").
- **Affirmation** — the human saying "yes" or "go ahead" to the assistant's *own* offer to commit or
  open a PR. That counts as invoking the skill. A "yes" to an unrelated offer does not — which is
  what the over-trigger controls check (CLAUDE.md, "AI Skills").
- **Delegation, and the delegation hand-off file** — `/ship` calls `/pr`, which calls `/commit`.
  Before each hop the parent writes `.claude/.nl-delegation-active` containing the parent's name and
  a timestamp, so the child knows it was delegated to rather than invoked directly and does not
  re-prompt. The child honours it only if it is **less than 30 seconds old** — that is the "30s
  lease" — and deletes it on read. The parent prints the hop, `Using /commit — delegated from /pr`,
  and the child suppresses its own announcement (`.claude/skills/ship/SKILL.md` step 3).
- **Permission rule (`allow` / `ask` / `deny`)** — an entry in `.claude/settings.json` classifying a
  command pattern. Precedence is **deny → ask → allow, first match**, evaluated by Claude Code
  *before* the command runs — so above anything a sandbox controls. This repo checks in one `ask`
  rule, on `Bash(gh pr merge *)` and the PowerShell equivalent
  ([`strategy-security.md`](strategy-security.md), "Agent merge guardrail").
- **Permission modes (`default`, `auto`, `bypassPermissions`)** — session-wide settings that change
  how an `ask` behaves. A checked-in `ask` cannot be weakened by a local `allow` or by
  `bypassPermissions`, but **`auto` mode auto-approves it**, and a prior "Yes, don't ask again"
  silences it for the rest of the session (`.claude/skills/ship/SKILL.md` step 12). §5 depends on
  this.
- **Untrusted workspace** — a directory in which Claude Code silently ignores local
  `permissions.allow` entries. Every sandbox is one; that is issue #531 (§5, §10).
- **Hook / `PreToolUse`** — a program Claude Code runs before a matching tool call, whose exit code
  can veto it: exit 0 allows, exit 2 blocks and feeds stderr back to the model. The harness has
  none; §8 is the design for one that was deliberately not built.
- **`claude -p` / headless** — running Claude Code non-interactively: a prompt in, a transcript out,
  nobody at the keyboard. This doc calls that *headless*. The consequence is that such a session can
  never be asked a question, which is why evals use scripted answers and why the routing grader
  needs the adaptations in §4.6.
- **`AskUserQuestion`** — the tool a skill uses to put a question to the human. It does not exist
  for subagents or headless sessions (constraint C6), so a Step-0 gate is graded by an observable
  proxy instead of a literal tool call.
- **Subagent** — a separate Claude session an orchestrating session launches for a scoped task. Here
  it is what runs one execution eval, and what grades it.
- **Cowork** — Anthropic's Claude Cowork, a separate Claude environment from Claude Code. It matters
  in this doc for one reason only: Layer C crashes on native Windows (constraint C2), and Cowork is
  one of the two places a teammate on Windows can run it instead (constraint C4, decision DP3).
  Upstream's `/skill-creator`
  `SKILL.md` carries a "Cowork-Specific Instructions" section and states the Layer-C scripts work
  there because they drive `claude -p` as a subprocess rather than a browser.
- **Advisory check** — a CI check that runs and is reported but is not required to pass. `/ship`
  waits on visible advisory checks as well as the required one; `ship-2a` exists to test what it
  does while one is still pending (`.claude/skills/ship/SKILL.md` step 8).
- **Must / Should / Could** — priority labels (the "MoSCoW" scheme) the program put on requirements
  and that this doc uses for assertions. A failing **Must** blocks; a **Should** is tracked but does
  not. Layer C is a *Should*, which is why §10's second open item does not block on its own.

#### This harness's own vocabulary

- **Harness** — everything under `scripts/skill-evals/`. Our code. Never the vendored skill-creator.
- **Vendored machinery** — `.claude/skills/skill-creator/`, pinned verbatim upstream. Script paths
  written bare — `scripts/quick_validate.py`, `agents/grader.md`, `eval-viewer/generate_review.py` —
  are relative to that directory. Every other path in this doc is relative to the repo root.
- **Sandbox** — one disposable directory tree built by `buildSandbox()`, containing a throwaway git
  repo, a local bare origin, the stub `gh`, and the sandbox marker. Torn down after every run.
- **Workspace** — `.claude/skills/<skill>-workspace/`, the *vendored* machinery's own output tree
  (`iteration-N/eval-X/` holding `eval_metadata.json`, `grading.json` and the rest — see §2's
  enabling insight). Gitignored, and it persists across runs. Not a sandbox: a sandbox is
  disposable git and `gh` state, a workspace is the durable-on-disk evidence a run leaves behind.
- **Sandbox marker** — the file `.skill-eval-sandbox`. Written at both the sandbox root and `repo/`.
  Nothing in the harness will act on a directory that lacks it. Not the delegation hand-off file
  above — different file, different job.
- **Fixture / fixture profile** — a named starting-state entry in `lib/fixtures.mjs`. Plain data.
- **Execution eval** — `kind: execution`. The prompt makes the skill do its work. Runs in a sandbox.
- **Routing eval** — `kind: routing`. Tests *whether or how* the skill fires. Runs through the
  routing runner.
- **Trigger eval** — a *different* thing, in a different file. `trigger-evals.json` holds short
  query/`should_trigger` pairs in the vendored machinery's own format; they are the training and
  test data for the Layer-C description-optimization loop. They are never run by the routing runner
  and never run together with routing evals (`strategy-skill-evals.md` §8).
- **Query** — one entry in `ROUTING_QUERIES`. Eleven queries cover nine routing evals: eight
  one-to-one, plus `commit-5`'s three.
- **Seed / seeded turns / turn** — a short fabricated conversation, written to `input.jsonl` and fed
  to a fresh headless session as if it had really happened. A **turn** is one message in it; some
  turns are attributed to the assistant. The session's *next* turn is the one graded. §11's "Seed"
  column counts turns.
- **Polarity** — what a correct run looks like for a routing query: **should-fire**,
  **should-NOT-fire** (an over-trigger control the skill must stay out of), or
  **should-fire-inline** (the skill runs, but because the human typed the slash the CLI expands it
  directly, so a correct run makes *no* `Skill` tool call).
- **Expectation / assertion** — one entry in an eval's `expectations` array. The schema field is
  `expectations`; this doc and its siblings call one entry an "assertion" in prose. Same thing.
- **`human_script`** — the pre-written replies an eval gives at the skill's human-approval
  checkpoints, since no human is present. Valid **only** inside a marker-bearing sandbox.
- **Arm** — one side of a comparison run. `with_skill` is the eval run against the current skill;
  `old_skill` is the same eval against the previous version, for comparison.
- **Layer A / B / C** — the three ways a skill is tested: **A** structural (is it well-formed?),
  **B** behavior (does it do the right things?), **C** triggering (does the right wording fire it?).
  Defined with their machinery in §2.
- **Red control** — a deliberately broken copy of a skill, used to prove an eval can actually FAIL.
  The mutated `SKILL.md` lives in a gitignored workspace and is never applied to the real skill
  files; the eval is re-run against it and the designated assertion must go red. The three on record
  are in §11.
- **Evidence triad** — transcript, `gh` call log, sandbox git state. `observables.json` is not a
  fourth leg: it corroborates the grader, it is not evidence in its own right (§6).
- **Observables** — the script-computed facts in `observables.json`. They corroborate the grader;
  they never replace it.
- **Trigger rate** — the fraction of repetitions in which a routing eval's skill fired.

#### Four words that used to mean more than one thing

- **"Baseline"** had four senses. This doc keeps them apart: **the baseline program** (always both
  words — the nine-phase program, #507, that built the harness); **the seed commit** (a sandbox's
  first commit on `main`); **the control arm** or **old-skill arm** (the comparison run against the
  previous version of a skill — upstream calls this the baseline arm); and **baseline completion**
  (the bar the program had to clear, §10).
- **"Marker"** was two files. The **sandbox marker** gates every harness operation; the **delegation
  hand-off file** tells one skill it was called by another. Both are defined above.
- **"The one rule"** was two rules. **The safety rule**: eval prompts are never executed against the
  real repo or real GitHub, any skill, any origin. **The full-batch rule**: when you change a skill
  or its evals, you run the whole execution batch, not just the part you touched
  (`strategy-skill-evals.md` §6).
- **"Batch"** was two units. The **execution batch** is one full run of every execution eval across
  all three skills, driven by `prompts/batch-prompt.md`. A **routing batch** is one full run of the
  eleven routing queries × N repetitions, driven by the routing runner. §11 counts routing batches.

### The tense rule

Present tense in this doc means: verified in the code as it stands at the Status line above.
Anything designed but not built lives in §8 and nowhere else. Every claim about code names a file
and a function or exported symbol. No line numbers appear anywhere — they rot.

## 1. Purpose

### The problem

The team's three Claude Code skills — `/commit`, `/pr`, `/ship` — encode the repo's guarded
commit → PR → merge workflow. The vendored `/skill-creator` ships a complete test kitchen for
skills, but its runner assumes evals are harmless: hand a subagent a prompt, grade the files it
produces. These three skills stage, commit, push, open PRs and merge. Run their evals naively and
the "test" makes real branches and real pull requests.

Underneath that is a succession problem. Verifying a skill change used to be a manual, AI-guided
pass that only Blake knew how to run. This is a small volunteer team with widely varying
experience; the moment the one person who can verify a skill change is unavailable, skills freeze
for everyone.

### The north star

**A skill change by someone other than Blake is routine — through the vendored `/skill-creator`
front door.** Every skill task starts by invoking `/skill-creator`, by slash command or natural
language. The infrastructure this doc describes engages underneath that door; the operator never
learns a second system and never performs an opt-in step to get safety.

### Success criteria

Carried forward from the baseline program that built this (§2, stage 4) and still the bar:

- A non-Blake operator can test a skill change in a small fraction of a session's time and tokens.
- A dev or agent can build, or fully re-eval, a skill end to end through `/skill-creator`'s stock
  flow with no help — the golden-path walkthrough. It passed all nine of its steps, run by someone
  other than the author, in Phase 5 (the fifth of the program's nine stages — §12); recorded on
  issue #507's body checklist, evidence on issue #513.
- Structural validation (Layer A — the three test layers are defined in §2) recorded for the four
  skills in the contract and vendored sets — `/commit`, `/pr`, `/ship`, `/skill-creator`.
  (`/handoff`, the fourth *team* skill, joined the same contract test in #585 — §10; the Layer-A
  record above predates it.)
- Every execution eval runnable end to end in a sandbox, graded by the native grader, aggregated by
  `aggregate_benchmark.py` (which rolls per-run grades into one `benchmark.json`), reviewed through
  `eval-viewer/generate_review.py` (which serves a browser page over that). Both are vendored, so
  both paths are relative to `.claude/skills/skill-creator/`.
- The contract test green in CI and in `/commit`'s local `npm test` gate.
- Trigger-eval sets exist for `/commit` and `/pr`, and the description-optimization loop has run
  at least once per skill with before/after train/test scores reviewed.
- **Zero real-repo or real-GitHub mutations during any eval run.**
- The nine routing evals graded as trigger rates.

**One of these eight is unmet:** the description-optimization loop has never run in a genuine
cloud or Cowork session. §10 explains why, alongside the other open baseline item — the macOS
platform-validation artifact, which is a completion gate rather than one of the criteria above.

### What this doc is and is not

**Is:** the as-built design record. Purpose, constraints, module map and data flow, the safety
model named to code, the reasoning behind the shape, the scenarios, the decision ledger, the
known gaps, the evidence on disk.

**Is not:** a runbook. It contains no operational run commands and no schema table — those live in
`strategy-skill-evals.md`, the doc most other docs point at; duplicating a runbook inside a design
doc is how the archived predecessor drifted out of date. The one exception is §11, which carries a
read-only script that reproduces its own evidence table.

## 2. Context

### How we got here — four stages of work

This section is historical context, and it is worth the four paragraphs: each stage solved a problem
the previous one created, and the harness only makes sense in that light. Full chronology and issue
numbers are in [`devjournal.md`](devjournal.md). Where two numbers appear below, the first is the
issue and the second the pull request most associated with it.

**Stage 1 — the three skills (issue #62; the spec landed as PR #133; May 2026).** The team's
check-in conventions lived in people's prompting habits. PR #133 landed
`spec-portable-ai-procedures.md`, which encoded them as three skills and fixed their step lists;
PR #283 landed the implementation plan; and the skills themselves arrived in commit `e61ddbe` on
2026-05-27. This stage created the dependency everything later inherits: **the skills mutate real
git and real GitHub.**

**Stage 2 — natural-language invocation (issue #353, with follow-on PR #484; June–July).** All
three skills started explicit-only, so humans had to remember to type the slash command.
`plan-skill-nl-invocation.md` designed the two-tier answer: `/commit` and `/pr` became
NL-invocable behind a Step-0 intent gate; `/ship` stayed explicit-only, backstopped by a checked-in
`ask` permission rule on `gh pr merge` in `.claude/settings.json`. PR #484 added the announcement
and affirmation routing.

> **What the routing evals are testing, in plain words.** A human can invoke `/commit` and `/pr` by
> typing the slash command *or* by just asking ("commit this"). On the natural-language path the
> skill first confirms intent — that confirmation is **Step 0** — and prints a line **announcing**
> which skill fired (`Using /commit`), so the human can see it. A human saying "yes" to the
> assistant's own offer to commit is an **affirmation**, and counts as invoking it too. Three
> situations skip the Step-0 confirmation: a typed slash, a fresh delegation hand-off file, and an
> opt-out file. `/ship` is excluded from all of this deliberately — it fires only on an explicit
> `/ship`. Nine of the thirty-five evals test exactly these behaviors. Full design:
> [`plan-skill-nl-invocation.md`](plan-skill-nl-invocation.md).

**That `ask` rule matters to everything after it.** It fires at the Claude Code permission layer —
*above* the sandbox, *before* the stub `gh` ever runs. So in an eval session a `gh pr merge` is
frequently intercepted and never logged. A `/ship` that wrongly merges leaves the same empty call
log as a correct abort. Every merge-adjacent grading decision in this system is shaped by that one
fact; it is why §5's trust boundary has a layer above the stub, why §6 says observables corroborate
rather than decide, and why the original plan for risk **R8** — the one about grading merges from
the call log — turned out to be wrong (§9's risk register). Its security rationale and
its own stated limits live in [`strategy-security.md`](strategy-security.md).

**Stage 3 — vendored skill-creator (issue #396; June–July).** Skills were built with
`/skill-creator`, which nobody had on clone. `plan-skill-creator-vendoring.md` vendored it, added
the contract test and a monthly drift workflow — and noticed that the committed evals were inert.

**Stage 4 — the skill-evals baseline program (issue #507, July onward).** That inertness became
this program. It ran in nine phases (§12); `strategy-skill-evals.md` grew alongside the build.
PR #530 (`7b8f157`, 2026-09-16) closed issues #527 and #528, hardened the routing runner and
corrected the grading of the `commit-5a` and `commit-5b` routing queries.

### The three test layers

The vendored machinery tests a skill in three layers. In every one, the pattern is the same: **the
vendored machinery does the work; our additions supply what it needs.** Paths in the *Vendored
machinery* column are relative to `.claude/skills/skill-creator/`.

| Layer | Question | Vendored machinery | What the harness adds |
|---|---|---|---|
| **A — structural** | Is the skill well-formed? | `scripts/quick_validate.py` (reference only) | `tests/functional/skills/skill-contract.test.ts` — the actual CI gate, and it also covers the eval-file shape |
| **B — behavior** | Does the skill do the right things? | the SKILL.md eval workflow, `agents/grader.md`, `scripts/aggregate_benchmark.py`, `eval-viewer/generate_review.py` | runnable eval definitions plus the sandbox harness |
| **C — triggering** | Does the right wording fire the skill? | `scripts/run_eval.py`, `scripts/run_loop.py`, `scripts/improve_description.py` | committed trigger sets plus platform routing (Windows → cloud/Cowork) |

Layer A's `/ship` divergence is expected and permanent: upstream's validator carries a strict
frontmatter key allowlist that predates `disable-model-invocation`. `doc-skill-creator.md` and
`strategy-skill-evals.md` §5 both cover it.

### The enabling insight

**No vendored script reads `evals/evals.json`.** The Python machinery operates on *workspace
artifacts* Claude writes during a run — `<skill>-workspace/iteration-N/eval-X/` holding
`eval_metadata.json`, run outputs, `timing.json`, `grading.json`, then `benchmark.json` via
`aggregate_benchmark.py`. Verified again at the Status date: no file under
`.claude/skills/skill-creator/scripts/` mentions `evals.json` or the `evals/` path at all.

This is the load-bearing architectural fact of the whole design. It means our additive eval-file
fields (`kind`, `fixture`, `human_script`, `expectations`) cost the vendored machinery nothing —
the eval file is just the source an orchestrating agent reads to generate the workspace artifacts.
The nonstandard format was therefore a small conversion problem, and the real work was the safe
execution environment. It is also what lets constraint C1 (never edit the vendored directory) hold
without any compromise.

## 3. The organizing rule and the constraints

**This section answers: which things you can do to a skill are dangerous, and what facts the design
had to work around?**

### Separate the verbs

**What the diagram shows:** of all the things you can do to a skill, only one — running its evals —
is dangerous. Everything else is ordinary file editing.

```mermaid
flowchart LR
  I["Agent is about to act on a skill or its evals"] --> D{"Which verb?"}
  D -->|"Create / Read / Update / Delete<br/>(skill bodies, eval definitions,<br/>assertions, trigger sets)"| CRUD["Plain file edits in the real repo.<br/>Native skill-creator flow, verbatim.<br/>Safe — protected by git + PR review<br/>+ the CI shape gate."]
  D -->|"Execute an eval"| EX["Sandbox only.<br/>make-sandbox builds the world,<br/>executors run inside it,<br/>marker rule: no marker, no run."]
```

CRUD on skills and evals is plain file editing — safe anywhere, fully native. **Execute is the one
dangerous verb**, and it was never safe vanilla. The harness is what makes `/skill-creator`'s
central tenet viable for side-effecting skills, not a restriction on it. Scope: actions on skills
and their evals. Everything else in the repo follows the normal dev workflow.

### Constraints

Ids are load-bearing — code comments, tests and the strategy doc cite several by bare number. Each
row says whether it **holds** as written or has **changed**.

| # | Constraint | Status today |
|---|---|---|
| **C1** | The vendored `.claude/skills/skill-creator/` directory stays verbatim upstream; only `UPSTREAM.md` is local. The refresh script clobbers anything else placed there — which is why `evals/skill-creator.evals.json` stays at the repo root. | **Holds.** `skill-contract.test.ts` asserts the root file's `skill_path` resolves and that each entry carries ≥3 evals. |
| **C2** | `run_eval.py` calls `select.select()` on a subprocess pipe — Unix-only; it raises `OSError [WinError 10093]` on native Windows, and `run_loop.py` imports it, so all of Layer C is Unix-only. | **Holds.** The routing runner sidesteps it entirely: `runExecutor()` and `runGrader()` in `routing/lib/driver.mjs` consume child stdout through Node stream events, never a `select()` equivalent. |
| C3 | Layer C scripts are needed only for description optimization; Layers A and B are plain file processing and run fine on native Windows. | Holds. |
| C4 | Cowork — the other environment upstream's skill-creator supports (§0) — can run the Layer C scripts. | Holds, still per upstream's own Cowork section — not independently verified. |
| C5 | Cloud Claude Code sessions are Linux; a nested `claude -p` (Claude Code driven non-interactively from inside another session — §0) in a cloud sandbox needs a one-time smoke test. | **Unverified in a genuine cloud session.** Nested `claude -p` is confirmed working on the native Windows host, which is not the case C5 is about. Tracked on #512. |
| C6 | The skills are interactive; subagents cannot use `AskUserQuestion`, so eval runs use scripted human replies, valid only inside a marker-bearing sandbox. | **Holds, and extended.** Headless `claude -p` has no `AskUserQuestion` either, so the routing grader grades an observable proxy — `runGrader()` in `routing/lib/driver.mjs` injects that adaptation into every grader prompt. |
| **C7** | Upstream `quick_validate.py` rejects `/ship`'s `disable-model-invocation` key. Accepted divergence; the repo's gate is the Vitest contract test. | **Holds.** |
| **C8** | The agent-guidance layers (CLAUDE.md, eval-file notices, the sandbox-marker rule) are prompt-level, not hard enforcement. The skills' human-approval checkpoints are also prompt-level in the eval context, since an agent holding a `human_script` can satisfy a checkpoint from the script instead of stalling. The only gate that fires regardless is the checked-in `ask` rule on `gh pr merge` — and it guards merges, not pushes or PR creation. | **Holds.** See §5 for what is structural and what is not. |
| C9 | `spec-portable-ai-procedures.md` §3 needs a clarification that `evals/` is upstream skill anatomy, not an auxiliary doc. | **Delivered.** That §3 now says so explicitly and links the strategy doc. |
| C10 | Python 3 + PyYAML is an authoring-time prerequisite; nothing in CI or the app runs the Python. | Holds. |
| **C11** | The `/ship` eval that exercises a *pending advisory check* — a CI check that is reported but not required to pass — takes ≥5 real minutes by design; it stays in the single execution batch, scheduled in the first parallel wave so its wait overlaps the others. | **Changed in naming only.** The eval is `ship-2a`; the scripted human answers it runs through are *wait*, *wait 5 more minutes* (`wait+5` is the literal menu choice `/ship` offers), *wait*, *abort* — about 10 minutes in all. `ship-2c` was removed in the Phase-7 right-sizing pass (§9). The scheduling rule is unchanged and is stated in `prompts/batch-prompt.md`. |
| **C12** | Real-repo testing is exception-only and gated: automated runs never touch the real repo, full stop; the sole allowed touch is an occasional human-run, AI-guided end-to-end smoke, gated by a recorded justification and a cleanup-owed runbook. | **Holds.** The runbook is `strategy-skill-evals.md` §10. |
| **C13** | Dead simple beats clever — usable and maintainable by 4–5 volunteer engineers at varying experience levels. The recorded tie-breaker: fixtures as data not a DSL; the stub as a lookup not a simulator; the tracker as an issue not a board; harness scripts in Node, not shell. | **Holds, and visible in the code.** `scripts/skill-evals/package.json` declares zero runtime dependencies; `lib/fixtures.mjs` is a plain object literal; only the three `gh` wrappers are shell. |
| **C14** | One cohesive testing story: the existing Vitest contract gate keeps working; the harness may enhance it but never interfere. The SKILL.md-structural assertions pass unchanged; the eval-artifact assertions were rewritten for the per-skill layout, and root `evals/evals.json` was deleted. | **Holds, and grew.** CI now runs two skill test files: `skill-contract.test.ts` and `routing-harness.test.ts`. Both sit in the same `functional-skills` Vitest project inside the required `Lint & Functional Tests` check — no new workflow, no new config. |

## 4. Module map and data flow

**This section answers: what are the evals, what code runs them, and what happens end to end?**

Everything the harness owns lives under `scripts/skill-evals/`. Node core only; zero runtime
dependencies; `package.json` pins `engines.node >= 20`, and `assertNodeEngine()` in `lib/engine.mjs`
re-checks it at runtime so a too-old Node fails with a sentence instead of an obscure API error.

### The eval roster

Thirty-six evals: twenty-seven `kind: execution` and nine `kind: routing`. The rest of this doc
argues about them by id, so here they are.

**Id scheme:** `<skill>-<n>` — the skill's name, then a number, scoped per skill. A letter suffix
(`commit-3a`, `ship-2a`) marks one sub-scenario of a single original eval that was split. Routing
*queries* may add a word (`commit-5a-slash`); those are §4.4's, not eval ids.

The first four columns are generated; the last is written by hand from each eval's own
`eval_name`.

| Id | Kind | Skill | Fixture | What it proves |
|---|---|---|---|---|
| `commit-1` | execution | commit | `feature-dirty-clean-payload` | Happy path: a dirty feature branch commits with a Conventional Commit subject |
| `commit-2` | execution | commit | `feature-dirty-with-env-local` | It refuses to stage a suspicious file (`.env.local`) that is sitting in the payload |
| `commit-3a` | execution | commit | `feature-schema-expand-only` | An expand-only schema change surfaces the post-PR deploy-dispatch note |
| `commit-3b` | execution | commit | `feature-schema-expand-plus-contract` | A combined expand-and-contract schema change is refused outright |
| `commit-4` | routing | commit | — | Natural-language commit intent routes through the Skill tool, with Step 0 |
| `commit-5` | routing | commit | — | Step 0 is skipped on exactly three paths: typed slash, delegation, opt-out file |
| `commit-6` | routing | commit | — | The assistant offers, the human says "yes": that affirmation routes through the skill and announces |
| `commit-7` | routing | commit | — | Over-trigger control: a bare "yes" to an offer to *explain* `/commit` must not run it |
| `commit-8` | routing | commit | — | Over-trigger control: "commit" as the topic of a question must not run it |
| `pr-1` | execution | pr | `feature-open-pr-two-new-commits` | Happy path: a PR already exists, so it comments on the newly pushed commits |
| `pr-2` | execution | pr | `feature-x-with-pr-on-feature-y` | It refuses when the named PR belongs to a different branch |
| `pr-3` | execution | pr | `feature-dirty-no-pr` | Dirty tree with no PR: it delegates to `/commit`, then creates the PR |
| `pr-4` | execution | pr | `feature-breaking-change-no-pr` | A new PR gets a Conventional Commit title and the breaking-change flag |
| `pr-5` | execution | pr | `feature-no-pr-cold-reviewer-cache` | Cold reviewer cache: the picker lists collaborators and takes a numeric pick |
| `pr-6` | execution | pr | `feature-no-pr-warm-reviewer-cache` | Warm cache: a reviewer named in plain language resolves without any `gh api` call |
| `pr-7` | execution | pr | `feature-no-pr-stale-reviewer-cache` | A stale cache makes `gh` reject a reviewer; it refreshes the cache and re-asks |
| `pr-8` | routing | pr | — | Natural-language PR intent routes through the Skill tool, with Step 0 |
| `pr-9` | routing | pr | — | The assistant offers, the human says "yes": that routes through `/pr` and announces |
| `ship-1` | execution | ship | `feature-open-pr-all-green` | Happy path: a pre-existing PR, all checks green, merges and watches |
| `ship-2a` | execution | ship | `feature-open-pr-advisory-pending` | A pending advisory check: it waits, offers `wait+5`, waits again, then aborts |
| `ship-2b` | execution | ship | `feature-open-pr-advisory-pending` | Same world, the human picks `troubleshoot` instead of waiting |
| `ship-3` | execution | ship | `docs-only-open-pr` | A docs-only PR: absent advisory checks are expected, so it merges on required-green |
| `ship-4` | routing | ship | — | Session control: "ship it" must *not* fire `/ship`, and must not simulate the merge |
| `ship-5` | routing | ship | — | Over-trigger control: "remind me what /ship does" explains, it does not ship |
| `ship-6` | execution | ship | `feature-dirty-no-pr` | The `/ship` → `/pr` → `/commit` cascade announces each hop exactly once |
| `ship-7` | execution | ship | `feature-open-pr-unanswered-comment` | A comment posted after the last push: it lists it, asks `1 unanswered since the last push — merge anyway?`, and does not merge on `no` |
| `handoff-1` | execution | handoff | `feature-uncommitted-fix-no-pr` | It reports the fix as uncommitted, contradicting the human's belief that it landed |
| `handoff-2` | execution | handoff | `feature-one-commit-clean-no-pr` | An existing hand-off doc is updated in place, with the old state kept under `Historical` |
| `handoff-3` | execution | handoff | `feature-one-commit-clean-no-pr` | Nothing in flight: it asks what the hand-off is for instead of inventing work |
| `handoff-4` | execution | handoff | `feature-one-commit-clean-no-pr` | `--mode minimal` contracts the doc, and the slug comes from the argument, not the flag |
| `handoff-5` | execution | handoff | `feature-migration-open-pr-teammate-wip` | `--mode full` produces the decision log, split validation and gated resume plan |
| `handoff-6` | execution | handoff | `feature-uncommitted-fix-no-pr` | Minimal depth selected from natural language alone, with no clarifying question |
| `handoff-7` | execution | handoff | `feature-two-commits-dirty-open-issue` | An explicit "compact" beats the complexity that would otherwise escalate to full |
| `handoff-8` | execution | handoff | `feature-migration-open-pr-teammate-wip` | Unprompted escalation to full when the recovery risk justifies it |
| `handoff-9` | execution | handoff | `feature-migration-open-pr-teammate-wip` | Compact overall, but the working-tree section expands for a file nobody owns |
| `handoff-10` | execution | handoff | `feature-migration-open-pr-teammate-wip` | Full depth from natural language, on the same world as the slash-full twin |

**The `/handoff` block is the one place a `Fixture` cell does not mean "a world built for this
eval".** Four profiles were built (`handoff-1`, `-4`, `-7`, `-8`); the other six name the nearest
one and record in their own `notes` exactly what that world is missing — `handoff-2`, `-3` and
`-5` are **not** gradeable as written until profiles of their own exist. That was decision 5 on
issue #585, and the ten worlds themselves are described file by file in the pre-harness builder
`.claude/skills/handoff/evals/build_fixtures.mjs`, kept as that record. `/handoff` has no routing
evals — if it gains any, add it to `TEAM_SKILLS` in `routing/lib/context.mjs`, which decides whose
skill files are copied into a routing sandbox.

The first four columns regenerate with this read-only command, from the four eval files:

```bash
node -e 'const fs=require("fs");for(const s of ["commit","pr","ship","handoff"]){for(const e of JSON.parse(fs.readFileSync(`.claude/skills/${s}/evals/evals.json`,"utf8")).evals){console.log([e.id,e.kind,s,e.fixture??"-",e.eval_name].join(" | "));}}'
```

```powershell
node -e 'const fs=require("fs");for(const s of ["commit","pr","ship","handoff"]){for(const e of JSON.parse(fs.readFileSync(".claude/skills/"+s+"/evals/evals.json","utf8")).evals){console.log([e.id,e.kind,s,e.fixture??"-",e.eval_name].join(" | "));}}'
```

**One eval, shown.** Illustrative only — the schema of record is `strategy-skill-evals.md` §3.
This is `commit-2`, trimmed:

```json
{
  "id": "commit-2",
  "kind": "execution",
  "eval_name": "refusal-env-local-in-payload",
  "prompt": "/commit \"add user endpoint\"",
  "fixture": "feature-dirty-with-env-local",
  "preconditions": "On a feature branch with a few edits to src/server/api.ts AND a modified `.env.local` in t…",
  "human_script": "When the skill names `.env.local` as a suspicious-file match and asks for direction, the human replies: remove it from the payload.",
  "expectations": [
    "The response names `.env.local` as a suspicious-file blocker match before any staging occurs",
    "No `git add` command in the command log stages `.env.local`",
    "…"
  ]
}
```

### 4.1 Entry points

| File | Job | Key symbols | Called by |
|---|---|---|---|
| `make-sandbox.mjs` | Build one sandbox for a named fixture and print either the human activation block or the raw manifest. | argument helpers `has`/`value`/`firstPositional`/`printHelp`; delegates to `listFixtures()` and `buildSandbox()` | humans, the batch prompt, the routing runner (indirectly, via `buildSandbox()`) |
| `teardown-sandbox.mjs` | Remove one sandbox or sweep all of them; `--archive <destDir>` captures evidence first, so archive-then-teardown is one operation. | delegates to `archiveEvidence()`, `teardownSandbox()`, `teardownAll()` | humans, the batch prompt |
| `archive-evidence.mjs` | Copy the harness-owned raw evidence legs into an eval's `outputs/` directory before teardown. | delegates to `archiveEvidence()` | the batch prompt, the executor prompt |
| `selfcheck.mjs` | Run the whole safety checklist and exit non-zero if anything fails. | `checkFixtureCompleteness`, `checkStubBehaviors`, `checkEnvScrub`, `checkTeardown`, `checkWrapperOnPath`, `checkGitBashActivation`, `checkEvidenceArchive`, `checkZeroMutation`, plus `runStub`, `findPosixShell`, `repoState`, `referencedFixtureNames`, `report` | humans, after any harness change |
| `fake-test.mjs` | The sandbox's `npm test`. Passes instantly; exits non-zero if a `.skill-eval-fail-test` sentinel exists in the working directory. | — | copied into each sandbox as `.skill-eval-fake-test.mjs` by `buildSandbox()` |
| `routing/run-routing-evals.mjs` | Drive the eleven routing queries as graded trigger rates. | `loadExpectations`, `buildInputJsonl`, `applySetupFiles`; top-level loop | humans |

`selfcheck.mjs` declares thirteen named checks and emits twenty-three result rows. Several checks
contribute more than one row — `default-deny`, for example, yields `exit`, `logged` and
`no-passthrough`. The check list itself is documented in
[`../scripts/skill-evals/README.md`](../scripts/skill-evals/README.md).

### 4.2 The library

| File | Job | Key exports |
|---|---|---|
| `lib/paths.mjs` | Path resolution and the load-bearing location guard. | `HARNESS_DIR`, `REPO_ROOT`, `MARKER_FILENAME` (`.skill-eval-sandbox`), `SANDBOX_PREFIX` (`skill-eval-`), `sandboxRoot(override)`, `assertOutsideRepo(target)`, `isSandbox(dir)` |
| `lib/engine.mjs` | Node floor, enforced at runtime. | `NODE_ENGINE_FLOOR`, `assertNodeEngine()` |
| `lib/fixtures.mjs` | The fixture profiles, as plain data, plus the shared baseline files every sandbox commits first. Nineteen profiles at the Status date — a count that moves whenever an eval is added, in lockstep with the file's own `// The 18 profiles.` comment. | `listFixtures()`, `getFixture(name)`, `assertNoCaseCollisions(name, profile)`, and the data constants `BASE_FILES`, `HUMANS`, `REVIEWER_COLLABORATORS`, `OWNER`, `REPO`, `SELF` |
| `lib/gh-fixture.mjs` | Turn a profile's `gh` block into the `gh-fixture.json` the stub answers from, deriving the reviewer display-name map. | `buildGhFixture(profile)` |
| `lib/sandbox.mjs` | Build, tear down and archive. The biggest module. | `buildSandbox({fixture, root, note})`, `teardownSandbox(dir)`, `teardownAll(root)`, `archiveEvidence(sandboxDir, destDir)`; internal helpers `git`, `gitSafe`, `forceRemove`, `clearReadOnly`, `setLocalConfig`, `writeFiles`, `writeTeamCache`, `writeMarker`, `installGhStub`, `writeActivateScripts`; the constant `SCRUB_UNSET` |

A fixture profile is a plain object. `getFixture()` returns it with a `name` key added; the fields
a profile itself declares are:

| Field | What it does |
|---|---|
| `summary` | One-line human description. Not read by the builder beyond being copied into the manifest. |
| `branch` | The feature branch the sandbox checks out after the seed commit on `main`. |
| `baseFilesExtra` | Extra files committed alongside `BASE_FILES` in the seed commit on `main`. |
| `branchCommits` | Ordered commits replayed on the feature branch; each is `{message, write, delete}`. |
| `pushedBranchCommits` | Push the branch to the bare origin **after** the Nth of those commits, leaving the rest unpushed. Omit it and nothing is pushed unless `openPr` is set. |
| `openPr` | `true` pushes the whole feature branch to the bare origin when `pushedBranchCommits` is absent. Set it whenever `gh.branchPr` claims a PR exists — a PR's head has to exist on origin, and a profile that sets `branchPr` without pushing builds a sandbox whose git state silently contradicts its own `preconditions`. |
| `working` | Uncommitted working-tree changes applied last: `{write, delete}`. This is what makes a fixture "dirty". |
| `teamCache` | Preseeds `/pr`'s reviewer cache: `{refreshedAtDaysAgo, collaborators, extraDisplayNames}`. Omit for a cold cache. |
| `gh` | The data the stub answers from: `owner`, `repo`, `auth`, `self`, `collaborators`, `issues`, `prs`, `branchPr`, `checks`, `runs`, `createPr`, `sequences`, `vercelProductionUrl`. |

`buildSandbox()` interprets most of these directly; the `gh` block goes through `buildGhFixture()`
and `teamCache` through `writeTeamCache()`. Profiles are written in house style using the
module-local helpers `existingPr()`, `featureModule()` and the constants `AUTH_OK`,
`REVIEWER_COLLABORATORS`, `OWNER`, `REPO`, `SELF` — copy the nearest existing profile rather than
writing one from scratch.

`buildSandbox()` runs these steps, in order:

1. Assert the Node floor.
2. Look up and validate the fixture profile.
3. Resolve the sandbox root and prove it is outside the repo.
4. Create that root `0700`, and the per-sandbox directory with `fs.mkdtempSync`.
5. `git init --bare` the origin, and `git init` the working repo.
6. Apply `setLocalConfig()` to the working repo.
7. Write `BASE_FILES` plus the profile's `baseFilesExtra`, commit them as the **seed commit**, add
   the local origin as a remote, and push `main`.
8. Create the feature branch and replay `branchCommits`, pushing at `pushedBranchCommits` if set.
9. Apply the profile's uncommitted `working` changes — this is what makes a fixture "dirty".
10. Write the preseeded reviewer team cache, if the profile asks for one.
11. Write the sandbox marker, copy `fake-test.mjs` in, and install the `gh` stub into `bin/`.
12. Write `gh-fixture.json` and an empty `gh-calls.log`.
13. Write `env.json`, the two activation scripts, and `manifest.json`.
14. Write the root-level marker, and return the manifest.

### 4.3 The `gh` stub

`gh-stub/gh-stub.mjs` is copied into every sandbox's `bin/`, alongside three thin wrappers — `gh`
(POSIX shell), `gh.ps1`, `gh.cmd` — that each exec `node gh-stub.mjs "$@"`. Because `bin/` is
prepended to `PATH`, this is the `gh` an executor runs.

`main()` refuses immediately if the sandbox marker is absent, then `dispatch()` routes on the first two
argv tokens. Every answered and every refused call is appended to `gh-calls.log` by `logCall()`,
which records `ts`, `argv`, `cwd`, `sub`, `credsPresent` (whether `GH_TOKEN`/`GITHUB_TOKEN` were
set), `ghConfigDir`, a `decision` of `answered` / `denied` / `no-marker` / `error`, the `exitCode`,
and per-handler extras.

| Subcommand | Handler | Behavior |
|---|---|---|
| `auth status` | `handleAuthStatus` | Writes to **stderr**, like real `gh`, and includes the literal `(SANDBOX gh stub)` — the string the executor prompt's stub-liveness gate greps for. Exit 0 logged in, 1 not. |
| `issue view <N>` | `handleIssueView` | Emits the fixture's issue JSON, or exit 1 if it is not `OPEN`. |
| `pr view [N]` | `handlePrView` | With a number, the fixture's `prs[N]` or `branchPr`; without, `branchPr`. Exit 1 when absent. Every fixture PR carries `comments`, `reviews` and `commits[].committedDate` for `/ship` step 10 (#580). |
| `pr list` | `handlePrList` | The read-only branch-PR-detection alias: emits `[branchPr]` or `[]`. |
| `pr create` | `handlePrCreate` | Consults the per-call sequence `sequences["pr create"]` **first**; only if the profile has none does it fall back to `createPr`'s URL. (`pr-7`'s error-then-success run depends on that precedence.) Logs the `--reviewer` and `--assignee` values. |
| `pr checks <N> [--watch]` | `handlePrChecks` | Prints one tab-separated line per fixture check. Exit **0** all pass, **8** any pending, **1** any fail — real `gh`'s codes. |
| `pr merge <N>` | `handlePrMerge` | Prints a simulated success, calls `recordMerge()` to append a durable record to `gh-stub-state.json`, and logs the `--merge` / `--delete-branch` / `--squash` flags. It never mutates the sandbox git tree, so the skill's own `git branch -d` still behaves. |
| `pr comment <N>` | `handlePrComment` | Returns a synthetic comment URL; logs whether a body was supplied. |
| `run list` / `run watch <id>` | `handleRunList` / `handleRunWatch` | Post-merge run discovery and watch, from the fixture's `runs`. |
| `api user` / `api users/<login>` / `api repos/<o>/<r>/collaborators` | `handleApi` | Emulates exactly the `--jq` filters `/pr` uses (`.login`, `.name // .login`, `.[].login`). Any other endpoint falls through to default-deny. |
| `api repos/<o>/<r>/pulls/<N>/comments` / `api graphql` | `handleApi` | `/ship` step 10's conversation read (#580): the fixture's `pullComments`, and — only for a query naming `reviewThreads` — the fixture's `reviewThreads` as one page (`hasNextPage: false`). Both empty by default; any other GraphQL query is default-denied. |
| anything else | `dispatch` default branch | **Default-deny.** |

Exit codes: **64** un-stubbed subcommand (default-deny), **66** sandbox marker missing, **70**
internal stub error. The stub never passes a call through to the real `gh`. Argument parsing is
handled by `positionals()`, `firstPositional(n)`, `hasFlag(name)`, `flagValue(name)` and
`stripSurroundingQuotes`, with `FLAGS_WITH_VALUE` telling the positional scanner which flags
consume the next token. `takeSequenced()` implements per-call sequencing by advancing a counter in
`gh-stub-state.json`.

The full surface table with "used by which skill" annotations lives in
[`../scripts/skill-evals/README.md`](../scripts/skill-evals/README.md); it is a superset of the
original design's illustrative list because `pr-1` and the ship evals genuinely call `pr comment`,
`run list` and `run watch`.

### 4.4 The routing runner

**How a routing eval works.** We want to know whether a skill fires in a given conversational
situation, so we fabricate that situation: a short scripted exchange — some turns from the human,
sometimes a turn attributed to the assistant — is written to `input.jsonl` and fed into a fresh
headless session as if it had really happened. The session's *next* turn is the one we grade.
Because the model is not deterministic, each query runs N times and the result is reported as a
rate, not a verdict.

| File | Job | Key exports |
|---|---|---|
| `routing/routing-plan.mjs` | The driver plan: one entry per **query**, carrying the seeded turns, the fixture, setup files, an optional `expectationsOverride` (replaces the eval's committed `expectations` for one sub-scenario — §6), and a `graderHint` (freeform scenario context appended to the grader's prompt — §6). | `ROUTING_QUERIES`, `FRESH_DELEGATION` |
| `routing/run-routing-evals.mjs` | Orchestrates build → context → setup → drive → archive → observe → render → grade → tear down, per query per repetition; then aggregates. | **Nothing** — the script executes on import, so `loadExpectations`, `buildInputJsonl` and `applySetupFiles` are module-local and cannot be pulled into a test. That is why `lib/summary.mjs` was extracted. |
| `routing/lib/context.mjs` | Copy the real repo's routing context into a sandbox so a fresh session *discovers* the skills. | `REPO_ROOT`, `extractAiSkillsSection(repoRoot)`, `populateRoutingContext(repoDir, repoRoot)` |
| `routing/lib/driver.mjs` | Shell out to `claude -p` twice — once as executor, once as grader — and recover the grader's JSON. | `sandboxEnv(manifest)`, `runExecutor(...)`, `graderSpawnSpec({...})` (pure: the grader's temp-dir cwd and argv, #584), `runGrader(...)` (resolves `{grading, numTurns, envelopeParsed, raw, stderr}`), `extractJsonObject(text)`; internal `isInside`, `repairEscapes`, `parseOrRepair`, and the constants `GRADER_MD_REL`, `GRADER_ALLOWED_TOOLS` |
| `routing/lib/grading.mjs` | Decide what a grader's answer is worth. A seam: the runner script cannot be imported, so the void rule lives here, pure and testable. | `interpretGraderEnvelope(raw)`, `graderPersistenceDecision({...})`; internal `voidReason`. It imports `extractJsonObject` from `driver.mjs`, which imports `interpretGraderEnvelope` back — a deliberate cycle, safe because both are hoisted function declarations used only at call time. |
| `routing/lib/transcript.mjs` | Turn the stream-json output into a graded transcript, render the fed input turns as ground truth, and compute observables. | `renderInputTurns(path)`, `parseEvents(outFile)`, `splitTurns(events)`, `turnItems(turn)`, `renderTurnMarkdown(turn, heading)`, `routingObservables(events, {skill, ghCallLog})` |
| `routing/lib/summary.mjs` | Per-eval aggregation, extracted from the runner script so it is unit-testable. | `NEGATIVE_CONTROLS`, `INLINE_FIRE`, `polarityFor(queryId)`, `summarizeEval({...})`, `formatSummaryLine(e)` |

`populateRoutingContext()` copies the three team `SKILL.md` files, `.claude/settings.json` (so the
`ask` rule is present exactly as in real life), and a sandbox `CLAUDE.md` whose body is the real
repo's `## AI Skills` section extracted verbatim by `extractAiSkillsSection()`. It refuses any
target that resolves inside the real repo, and refuses any directory without the sandbox marker.

`runExecutor()` spawns `claude -p` with `--input-format stream-json --output-format stream-json
--verbose --model <m> --allowedTools "Bash Read Grep Glob Edit Write Skill TodoWrite"
--permission-mode acceptEdits`, cwd set to the sandbox repo and env from `sandboxEnv()`. It writes
the input JSONL to the child's stdin, streams stdout to `raw.jsonl`, and kills the child with
`SIGKILL` after 240 seconds — the routing decision lands early, so a timeout still leaves a
gradeable turn. `runGrader()` spawns a second `claude -p` with `--output-format json`,
`--allowedTools "Read Grep Glob Bash"` and a 180-second timeout. Its cwd is **not** the run
directory: `graderSpawnSpec()` names a fresh directory under the OS temp dir, `runGrader()` copies
the run directory there and grades from the copy, so the prompt's relative paths (`./transcript.md`,
`./outputs/` …) resolve unchanged. The run directory defaults to inside this checkout, and with
`Bash` allowed a `git log` from there walked up into the real repo — in the 2026-09-19 batch a
grader took the real repo's history for the sandbox's and passed wrongly (#584). `Bash` stays
allowed: a probe showed a read-only session still reads absolute paths outside its cwd, so dropping
`Bash` alone was not shown to be enough. The move changes where the grader starts, not what it can
name — it is not a sandbox. The copy is deleted once a verdict is extracted and left in place, its
path printed to stderr, when none is; the grader's envelope and verdict are written back to the
original run directory.

**The eleven queries.** Nine routing evals, eleven queries, because `commit-5` fans out
(§6 explains why):

| Query | Source eval | Skill | Polarity |
|---|---|---|---|
| `commit-4` | `commit-4` | commit | should-fire |
| `commit-5a-slash` | `commit-5` | commit | should-fire-inline |
| `commit-5b-delegation` | `commit-5` | commit | should-fire |
| `commit-5c-optout` | `commit-5` | commit | should-fire |
| `commit-6` | `commit-6` | commit | should-fire |
| `commit-7` | `commit-7` | commit | should-NOT-fire |
| `commit-8` | `commit-8` | commit | should-NOT-fire |
| `pr-8` | `pr-8` | pr | should-fire |
| `pr-9` | `pr-9` | pr | should-fire |
| `ship-4` | `ship-4` | ship | should-NOT-fire |
| `ship-5` | `ship-5` | ship | should-NOT-fire |

***Polarity* = what a correct run looks like.** **should-fire**: the skill runs. **should-NOT-fire**:
the skill must stay out of it — an over-trigger control. **should-fire-inline**: the skill runs, but
because the human typed the slash command the CLI expands it directly, so a correct run makes *no*
`Skill` tool call (§6 explains why that is not a failure).

Polarity comes from `polarityFor()`: `NEGATIVE_CONTROLS` holds the four over-trigger controls,
`INLINE_FIRE` holds `commit-5a-slash` alone.

### 4.5 Flow — one execution eval

An execution eval is driven by an orchestrating session following
`prompts/batch-prompt.md`, which fans `prompts/executor-prompt.md` across every `kind: execution`
eval. There is no execution-eval runner script; the orchestration is a prompt, deliberately (§6).

**What the diagram shows:** one eval, one sandbox, one grade, then teardown — and nothing in the
loop touches the real repo or real GitHub.

```mermaid
sequenceDiagram
  participant O as Orchestrating session
  participant MS as make-sandbox.mjs
  participant SB as Sandbox (repo + origin.git + bin/)
  participant X as Executor subagent
  participant AE as archive-evidence.mjs
  participant G as Grader (agents/grader.md)

  O->>MS: --fixture {eval.fixture} --json
  MS->>SB: buildSandbox() — git repo, bare origin,<br/>marker, gh stub, fake npm test, activate scripts
  MS-->>O: manifest.json (repoDir, activate.*, ghCallLog)
  O->>X: executor-prompt.md, placeholders filled
  X->>SB: marker gate, then stub-liveness gate<br/>(gh auth status must print "(SANDBOX gh stub)")
  X->>SB: runs the skill's steps — git against the sandbox,<br/>gh answered and logged by the stub
  X-->>O: transcript incl. verbatim tool-call record
  O->>AE: archiveEvidence(sandboxDir, {eval}/outputs)
  AE-->>O: gh-calls.log · git-state.txt · gh-stub-state.json ·<br/>gh-fixture.json · manifest.json · sandbox-marker.json ·<br/>archive-manifest.json
  O->>G: transcript + archived raw files (the evidence triad —<br/>transcript, gh call log, sandbox git state) + eval.expectations
  G-->>O: grading.json
  O->>SB: teardown-sandbox.mjs (sweep with --all at the end)
```

Two gates in that flow are non-negotiable and both live in `prompts/executor-prompt.md`: the
**marker gate** (no `.skill-eval-sandbox` in cwd → stop) and the **stub-liveness gate** (`gh auth
status` must print `(SANDBOX gh stub)` on stderr, or the real GitHub CLI won the `PATH` race →
stop). The second exists because credential scrubbing still blocks a real-GitHub reach even when
`PATH` is misrouted, but the stub's call log then silently goes dark — and grading against a dark
log is worse than not grading.

Archiving happens **before** teardown, as harness behavior rather than a request an agent may skip.
`archiveEvidence()` also writes `archive-manifest.json` recording which legs were captured and
restating the merge-discrimination caveat, so a reader of the archive alone cannot misread an empty
log.

### 4.6 Flow — one routing eval

**What the diagram shows:** the runner does by script what the execution flow does by prompt —
build a sandbox, make the skills *discoverable* in it, drive one fresh headless session, grade the
last turn, tear down — repeated N times so the result is a rate.

```mermaid
sequenceDiagram
  participant R as run-routing-evals.mjs
  participant SB as Sandbox
  participant C as context.mjs
  participant E as claude -p (executor)
  participant T as transcript.mjs
  participant GR as claude -p (grader)
  participant S as summary.mjs

  R->>SB: buildSandbox({fixture})
  R->>C: populateRoutingContext(repoDir)
  C->>SB: 3× SKILL.md · settings.json (ask rule) ·<br/>CLAUDE.md carrying the real "AI Skills" section
  R->>SB: applySetupFiles — opt-out file /<br/>fresh delegation hand-off file (pr\t<now>)
  R->>R: buildInputJsonl(q.turns) → input.jsonl
  R->>E: spawn with --input-format stream-json,<br/>cwd = sandbox repo, env = sandboxEnv(manifest)
  E-->>R: raw.jsonl (stream-json events)
  R->>SB: archiveEvidence(sandboxDir, outputs/)
  R->>T: parseEvents → routingObservables → splitTurns →<br/>renderTurnMarkdown(last turn)
  T-->>R: observables.json · transcript.md
  R->>GR: grader.md verbatim + rendered input.jsonl +<br/>expectations + headless adaptations + graderHint
  GR-->>R: envelope → grader-envelope.json (always)
  R->>R: interpretGraderEnvelope → graderPersistenceDecision<br/>(void a zero-tool-call grading) → grading.json
  R->>SB: teardownSandbox (unless --keep-sandboxes)
  R->>S: summarizeEval per query
  S-->>R: routing_summary.json, then aggregate_benchmark.py
```

Four details in that flow matter and are easy to get wrong:

1. **The grader is handed the fed input turns as ground truth.** `runGrader()` inlines
   `renderInputTurns(input.jsonl)` into the prompt and states a **seed-presence rule**: any claim
   about whether a prior turn was present must be answered from that rendering, never inferred from
   `transcript.md` (only the final graded turn) or `raw.jsonl` (the executor's *output* stream,
   which structurally never carries the fed turns as history). `renderInputTurns()` distinguishes a
   legitimate single-turn eval — "Seeded prior turns: NONE" — from a missing, empty or unparseable
   file, which it reports as unverifiable rather than asserting a negative.
2. **The runner owns timing and metrics.** After the grader returns, the runner overwrites
   `grading.timing` with real wall-clock numbers and fills `execution_metrics`, then coerces
   `user_notes_summary` and `expectations` to the shapes `aggregate_benchmark.py` expects. A grader
   that emits `null` there would otherwise crash the Python aggregate.
3. **Ungraded runs are loud.** When `extractJsonObject()` returns null the runner writes
   `grader-raw.txt` instead of `grading.json` — beside the `grader-envelope.json` it saves for
   every grading (4) — `summarizeEval()` counts the run in `ungraded_runs`
   and names it in `ungraded`, and the runner prints a warning. The mean is still taken over graded
   runs only — you cannot average a result you do not have — but the count sits beside it so a
   batch cannot quietly shed failing reps and report a flattering number.
4. **A grading that gathered no evidence is void.** The runner saves the grader's raw envelope to
   `grader-envelope.json` for *every* grading, before deciding anything, so how a verdict was
   reached is always on disk. `graderPersistenceDecision()` in `lib/grading.mjs` then voids the
   grading when the envelope reports `num_turns <= 1` — a grader that answered in one turn opened
   no file — or when the turn count is unknowable (stdout was not an envelope, or the envelope
   carries no numeric `num_turns`). A void grading is discarded symmetrically, PASS or FAIL: no
   `grading.json`, no `timing.json`, a null pass rate, and an `error` naming which of the three
   conditions fired, so it lands in `ungraded_runs` with its reason instead of inside the mean.
   The runner prints `pass=VOID` for that run. The defect this closes was real: a `ship-5` re-grade
   returned a clean 3/3 PASS having made zero tool calls, and that 1.0 counted (#583).

### 4.7 Artifacts

**Inside a sandbox** — `repo/` (the executor's cwd, holding the sandbox marker, `.git`, the seed-commit files
and `.skill-eval-fake-test.mjs`), `origin.git/` (the local bare push target), `bin/` (the stub and
its three wrappers), `gh-config/` (the isolated `GH_CONFIG_DIR`), `gh-fixture.json`,
`gh-calls.log`, `gh-stub-state.json`, `env.json`, `activate.sh`, `activate.ps1`, `manifest.json`,
and a root-level marker so an audit or sweep can identify the directory even if `repo/` is gone.

**Archived into an eval's `outputs/`** — `gh-calls.log`, `gh-stub-state.json`, `gh-fixture.json`,
`manifest.json`, `sandbox-marker.json`, `git-state.txt`, `archive-manifest.json`, and `scratch/`
when the run left anything in the sandbox repo's `.scratch/`. `git-state.txt`
is a labelled dump of `rev-parse HEAD`, `status --porcelain=v1 -b`, `log --oneline --all -n 50`,
`branch -avv`, `reflog -n 50`, unstaged and staged diffs, plus the bare origin's log and branch
list. Every command runs through `gitSafe()`, so a failure becomes a bracketed note in the dump
rather than aborting the archive. The `scratch/` copy exists because a skill whose deliverable is
a **file** leaves nothing in the two objective legs: `/handoff` writes
`.scratch/<slug>-bootstrap.md`, which is gitignored inside the sandbox and so never appears in
`git-state.txt`. Copying it verbatim is what lets the grader read the produced document instead of
prose about it (#585, decision 2); `archive-manifest.json`'s `legs.producedDocs` lists what was
copied, and is empty for every skill that produces no such file.

**A routing run adds** `input.jsonl`, `seeded-turns.md` (the on-disk audit copy of what the grader
was shown), `raw.jsonl`, `executor.err`, `transcript.md`, `grader-envelope.json` (the grader's own
raw stdout, written for every grading), `timing.json` and `grading.json` — present only when the
grading stands, absent when it was voided (§4.6) and replaced by
`grader-raw.txt` when no verdict could be extracted at all —
`runner-error.txt` on a thrown error, and `outputs/observables.json`. At batch
level: `eval_metadata.json` per query, `routing_summary.json`, and `benchmark.json` / `benchmark.md`
from `aggregate_benchmark.py`. The tree shape is documented in
[`../scripts/skill-evals/routing/README.md`](../scripts/skill-evals/routing/README.md).

`observables.json` carries `firstText` (the opening of the model's first text block, where an
announcement would be), `announcementPresent`, `announcementIsFirstLine`, `skillInvocations`,
`invokedThisSkill`, `mutatingBashCmds`, `askUserQuestionUsed`, `ghLog` (`present`, `lines`,
`hasPrMerge`, `live`), `result` (the session's own completion record — subtype, internal step count,
duration) and `numGradedTools` (how many tool calls the graded turn made).

### 4.8 What CI runs — and what it does not

`.github/workflows/ci.yml`'s `Lint & Functional Tests` job is the required check. It runs Biome and
the Vitest functional suites, which include both skill test files. A docs-only PR skips the work
via a `paths-filter` step but still reports success, so branch protection is satisfied.

**No workflow runs the harness, the selfcheck, or any eval.** Eval runs are human-triggered, by a
person or their session's agent, by design (the reasoning is in §6). The only other skill-related
workflow is `.github/workflows/skill-creator-drift.yml`, a monthly read-only check that opens one
tracking issue when the vendored pin falls behind upstream.

`tests/functional/skills/skill-contract.test.ts` holds all four team skills — `/commit`, `/pr`,
`/ship`, and `/handoff` since issue #585 — to their
structure: frontmatter `name` matching the directory, the per-skill invocation policy in
`EXPLICIT_ONLY`, the `REQUIRED_SECTIONS` subsequence, the `SOFT_LINE_CAP` warning — and pins the
eval artifacts: allowed `kind` values in `ALLOWED_KINDS`, `fixture` plus ≥1 expectation on every
execution eval, the exact execution-eval id set in `EXPECTED_EXECUTION_IDS`, and the continued
absence of root `evals/evals.json`. `tests/functional/skills/routing-harness.test.ts` covers the
routing harness's pure functions — `extractJsonObject`, `interpretGraderEnvelope`,
`graderPersistenceDecision`, `renderInputTurns`, `summarizeEval`, `polarityFor` — one case per
defect found in the #527/#528 review, plus the zero-tool-call void rule from #583.

## 5. Safety and the trust boundary

**The boundary:** everything inside a marker-bearing sandbox is disposable and may be mutated
freely; everything outside it is the real repo, where eval execution is forbidden and only the
normal human-approved workflows change state.

The mechanisms, named to where they live:

| # | Mechanism | Where |
|---|---|---|
| 1 | **The sandbox can never be inside the repo.** Every resolved path is run through a guard that refuses the repo root or anything under it. | `assertOutsideRepo()` in `lib/paths.mjs`, called by `buildSandbox()`, `teardownSandbox()`, `teardownAll()` and `archiveEvidence()` in `lib/sandbox.mjs` |
| 2 | **Each sandbox is a unique, private, exclusively-created directory.** The root is created `0700`; the per-sandbox directory uses `fs.mkdtempSync`, so nothing lands in a fixed, pre-creatable path. | `buildSandbox()` in `lib/sandbox.mjs` |
| 3 | **No marker, no run.** Two markers are written: `writeMarker()` writes the `repo/` one (the payload the stub and the executor check), and `buildSandbox()` writes a leaner root-level one inline so an audit or sweep can still identify the directory if `repo/` is gone. The stub refuses without the `repo/` marker; the routing context installer refuses without it; teardown refuses a directory that has neither marker nor a manifest. | `writeMarker()` and `buildSandbox()`'s root-marker write, both in `lib/sandbox.mjs`; `main()` in `gh-stub/gh-stub.mjs` (exit 66); `populateRoutingContext()` in `routing/lib/context.mjs`; `teardownSandbox()` in `lib/sandbox.mjs` |
| 4 | **Default-deny `gh`.** Anything outside the traced surface hard-fails and is logged; it never passes through to the real `gh`. Unknown `api` endpoints deny too. | the default branch of `dispatch()` and of `handleApi()` in `gh-stub/gh-stub.mjs` (exit 64) |
| 5 | **Credentials are scrubbed and `gh` config is isolated.** `GH_TOKEN`, `GITHUB_TOKEN`, `GH_ENTERPRISE_TOKEN` and `GITHUB_ENTERPRISE_TOKEN` are unset and `GH_CONFIG_DIR` is pointed inside the sandbox — declared in `env.json`, applied by both activation scripts, and applied in-process for the routing runner. | `SCRUB_UNSET` and `writeActivateScripts()` in `lib/sandbox.mjs`; `sandboxEnv()` in `routing/lib/driver.mjs` |
| 6 | **There is no real GitHub to reach.** `origin` is a local bare repository addressed by a `file://` URL, so a push lands on disk. | `buildSandbox()` in `lib/sandbox.mjs` |
| 7 | **The sandbox repo runs no hooks and signs nothing.** `core.hooksPath` points at a directory that does not exist; `commit.gpgsign` and `tag.gpgsign` are false; `gc.auto` is 0. | `setLocalConfig()` in `lib/sandbox.mjs` |
| 8 | **Every call is evidence.** Answered and denied calls alike are appended to `gh-calls.log`, with whether credentials were present at call time. | `logCall()` in `gh-stub/gh-stub.mjs` |
| 9 | **Liveness before any negative.** A "the log contains no X" claim is trusted only when the log is non-empty — and a merge-negative is stricter still: the log never PASSes a merge-negative on its own, empty or not (`strategy-skill-evals.md` §6). | `ghLog.live` from `routingObservables()` in `routing/lib/transcript.mjs`; stated to the grader by `runGrader()` in `routing/lib/driver.mjs`; stated to humans in `prompts/executor-prompt.md` |
| 10 | **Fixtures can never depend on case-distinct filenames**, because macOS's default filesystem is case-insensitive. | `assertNoCaseCollisions()` in `lib/fixtures.mjs`, called from `getFixture()` |
| 11 | **The real repo is audited after a selfcheck run** — HEAD, the full `git branch --list` output and `git status` must all be byte-identical before and after, which catches any leaked branch. A hardcoded list of thirteen of the eighteen distinct fixture branch names is additionally checked by name, belt-and-braces. | `checkZeroMutation()` in `selfcheck.mjs` |
| 12 | **The whole checklist is executable.** Thirteen named checks, twenty-three rows, exit 0 only if every row passes; among them a genuine POSIX-shell activation check that sources `activate.sh` and runs a bare `gh`. | `selfcheck.mjs`, especially `checkGitBashActivation()` and `findPosixShell()` |

### Above the stub

One gate fires outside all of that: the checked-in `ask` permission rule on `Bash(gh pr merge *)`
and `PowerShell(gh pr merge *)` in `.claude/settings.json`. It is evaluated at the Claude Code
permission layer, before any command runs, so it sits **above** the sandbox rather than inside it.

That has two consequences the harness is built around. First, it is the sturdiest gate C8 can point
to, though not an absolute one. Per `.claude/skills/ship/SKILL.md` step 12, which is the source of
record for this rule's behavior: precedence is deny → ask → allow, first match, so the checked-in
`ask` cannot be weakened by a local `allow` or by `bypassPermissions` — but **`auto` mode
auto-approves it, and a prior "Yes, don't ask again" silences it for the rest of the session.** A
guaranteed prompt means running in default mode. Second, it
breaks naive merge grading — an intercepted `gh pr merge` never reaches the stub, so it is never
logged, so an empty log proves nothing. The rule for grading is therefore: **grade merge-adjacent
assertions from the transcript's tool-call record**, corroborated by the log and
`gh-stub-state.json` where the environment let the call through, and never pass a merge-negative
on the log alone — empty or not. `handlePrMerge()` in `gh-stub/gh-stub.mjs` carries that caveat inline;
`archiveEvidence()` restates it in every `archive-manifest.json`; `strategy-skill-evals.md` §6 is
its home.

### What is not protected

- **Sandbox `permissions.allow` entries are silently ignored.** An untrusted workspace does not
  honor them, with no error. So the `ask` rule copied into a sandbox by `populateRoutingContext()`
  cannot be locally relaxed for a headless run, and a future attempt to permit something inside a
  sandbox by settings alone will fail quietly. Tracked as **#531**.
- **Nothing inside `.claude/` can be deleted headless.** Built-in Claude Code protection refuses
  it; the same filename in another directory deletes fine, so the trigger is the directory. This is
  why `/commit`'s clear-on-read of the delegation hand-off file cannot be graded by the routing runner —
  `routing-plan.mjs` documents the exclusion on `commit-5b-delegation`, and the manual runbook in
  `strategy-skill-evals.md` §6 covers it instead.
- **The guidance layers are prompt-level (C8).** An agent that ignores CLAUDE.md, the eval files'
  `$comment` notices and the sandbox-marker rule, while holding a `human_script`, can satisfy an approval
  checkpoint from the script rather than stalling. The backstop stack — structural isolation, the
  default-deny stub, the `ask` rule, the CI shape gate, and plain git recoverability — means a
  missed layer degrades to *recoverable and loud*, never *silent damage*. That is the honest scope
  of the safety guarantee: structural against accidental mutation, prompt-level against deliberate
  deviation.

## 6. Why it is shaped this way

**This section answers: for each choice a reader might ask "why not the obvious thing?" about, what
was the reason?** Eight of those, then — at the end — the rules for writing an assertion worth
keeping.

### Per-skill eval layout (DP1)

*(DP = design point. DP1–DP4 are the program's numbered architecture decisions, distinct from the
C-numbered constraints in §3 and the R-numbered risks in §9. All four are in §9's ledger.)*

Evals live at `.claude/skills/<skill>/evals/evals.json` — upstream's own documented location —
rather than in one repo-root file. The decision was reversed from "convert the root file in place"
on a single named criterion: **upstream instructions must work verbatim**. Under the root-file
option the bridging pointer would have lived in CLAUDE.md, itself a local translation layer, and
every future upstream refresh would have had to be re-reconciled against it. A **cascade eval** —
one that tests a skill delegating onward, as `ship-6` tests `/ship` → `/pr` → `/commit` — is filed
under whichever skill the eval's *prompt* invokes, so `ship-6` lives with `/ship`. `evals/skill-creator.evals.json` stays at the
repo root because of C1 — the refresh script clobbers anything else placed in the vendored
directory. The cost of the layout is risk R2: deleting and recreating a skill folder takes its
evals with it.

### Skill-creator kept stock

Nothing in the vendored directory is edited, ever — including the Windows `select()` bug, which
goes upstream rather than into a local patch. This is affordable only because of the enabling
insight (§2): the vendored scripts never read our eval files, so additive fields cost them nothing,
and the sandbox is invisible to them because it is just a working directory. The one accepted
divergence, `quick_validate.py` rejecting `disable-model-invocation`, is documented in two places
rather than patched away.

### Fixtures as data, not a DSL (C13)

`lib/fixtures.mjs` is a plain object literal read by `buildSandbox()`. Adding an eval is usually
adding a named starting state, not touching the harness. A DSL or a fixture-builder API would have
bought expressiveness nobody on a 4–5 person volunteer team needs, at the cost of a second thing to
learn before you can write a test. The same tie-breaker chose Node over shell for the harness core
(shell behaves differently per OS; Node does not, and this is a Node repo), a lookup stub over a
GitHub simulator, and a GitHub issue over a project board as the tracker.

### The execution batch is a prompt, not a script

There is no `run-execution-evals.mjs`. The batch is `prompts/batch-prompt.md` handed to an
orchestrating session, which fans `prompts/executor-prompt.md` across the evals. That is deliberate:
the executor *is* an LLM following a skill faithfully, including its approval checkpoints, so the
orchestration layer is prompt-shaped all the way down. Scripting it would mean scripting the part
that has to be judgment. The routing runner is a script precisely because its executor is a fresh
`claude -p` session with no judgment to supply — the harness only has to launch it and read what
came back.

### One batch, never CI

The full-batch rule is: when you change a skill, or refresh the vendored copy, you run the whole
batch. There is deliberately no lighter per-skill variant documented anywhere, because a lighter
variant is what people reach for and then the regression suite stops being a regression suite. Runs
stay human-triggered — never CI — because an LLM-driven run costs real money and real minutes and
is not deterministic; CI-gating it would make every unrelated PR pay for it. What CI does gate is
the deterministic shape check. A deliberate skip is an unchecked PR-template box with a stated
reason, visible to reviewers.

### The `commit-5` fan-out and `expectationsOverride`

`commit-5` is **one** routing eval in the committed eval file, because the conversion manifest only
splits *execution* evals into separate entries — that splitting rule
applies to execution evals only. But it has three sub-scenarios — typed slash, delegation, opt-out
— that cannot be driven by one query. `routing-plan.mjs` is the de-multiplexer: three entries
(`commit-5a-slash`, `commit-5b-delegation`, `commit-5c-optout`) all carry `evalId: "commit-5"` and
each supplies its own `expectationsOverride`.

`loadExpectations()` in `run-routing-evals.mjs` returns `expectationsOverride` when present and
otherwise loads the eval's committed `expectations` from the eval file. So the committed file stays
the source of truth for every ordinary query, and the override exists for exactly one reason: to
say something true of a sub-scenario that is not true of its parent eval. The clearest case is
`commit-5a-slash`, whose override states that a typed `/commit` is expanded by the CLI's own slash
parser and injected directly — it never routes through the `Skill` tool, so `invokedThisSkill:
false` is *correct*, and grading it as a failure is the bug.

`graderHint` is the third input to grading, alongside the expectations and the transcript.
`runGrader()` appends it under an "Eval-specific grader note" heading after the two headless
adaptations. A hint's job is to tell the grader **what the scenario is and where the evidence
lives** — the seeded turns, the fixture facts, the harness limitation that makes a particular
behavior expected. A hint that carries an assertion the eval file does not state, or a pass/fail
rule the assertion contradicts, is a defect: it makes graders enforce requirements nobody reviewed.

### Observables corroborate; they do not decide

`routingObservables()` computes facts a script can check — was the announcement the first line, was
a `Skill` tool call made, were mutating git commands run, does the call log contain `pr merge`, is
the log live. None of them is a verdict. The comments in `transcript.mjs` say so explicitly about
the ad-hoc-bypass flag: git commands that run *after* the skill was invoked are the skill's own
steps, not a bypass, and only the LLM grader can tell the difference. Observables exist so the
grader can be corroborated against ground truth rather than trusted on narration, and so a human
auditing the run has numbers to check.

### Advisory ranges, no numeric thresholds

A typical full batch runs roughly 60–90 minutes and about 2M tokens. Those are documented reference
points, not gates — nothing could enforce them, because batch runs are human-triggered. **Pass rate
has no numeric floor, by design.** The gate stays what it always was: every Must-level assertion —
a *Must* is one whose failure blocks, a *Should* is tracked but does not (§0) — passes, or a human
explicitly decides in writing to accept the failure. A "95% is fine" bar would let a fixed slice
of real regressions through unexamined, which defeats the point of a regression suite. Routing is
separately probabilistic (R5) and is reported as rates over repetitions, never as a binary verdict.

### Assertion-design rules

These were learned the hard way in #527/#528 and are the rules to apply next time an eval looks
flaky.

**Keep an assertion only if it checks function.** Five functions are worth asserting: (a) the skill
follows its documented procedure; (b) it lands — the work actually completes; (c) it catches an
error or refuses what it must; (d) it invokes another skill when it should; (e) it keeps the
watching human reasonably informed. An assertion that checks none of those is checking wording.

**Observable only.** If the grader cannot point at a line in the transcript, the call log, the git
dump or the observables, the assertion is prose judgment and will drift.

**One check per assertion.** A bundled assertion cannot fail informatively, and a bundle that
contains one impossible clause fails forever for the wrong reason.

**Name the break it catches.** If you cannot say which regression the assertion would catch, it is
not carrying weight.

**Rates are recorded, never gated.** Write the measured numbers down; do not convert them into a
threshold.

**When an eval is flaky, presume the test before the skill.** The three skills are battle-tested in
daily use; a suite that disagrees with them is far more likely to be wrong than they are.

**Sort variance by locus before touching the eval.** There are four: the *grader* (prompt, model,
parse), the *headless environment* (no `AskUserQuestion`, `.claude/` write-protection, the `ask`
rule), the *harness* (seed shape, setup-file timing, escape handling), and the *tested agent*. Only
the last one justifies changing a skill, and only the first and third usually justify changing an
eval.

**Stop after the third round, or after the first fix that does not move the rate.** Churn on a
probabilistic eval is how you end up over-fitting the test to one batch.

**Worked example: the #527/#528 investigation.** `commit-5b`'s delegation eval was reported at
roughly a 0.35 pass rate. (§11 discusses a *different* ≈0.35, belonging to `commit-5a` — two
coincidentally similar numbers for two different queries, which is itself part of why §11 exists.)
Sorting by locus found three distinct causes, and not one of them was the skill.

- *Harness.* The original seed made the human's first turn `commit this`, which is a second,
  competing routing signal — a real `/pr` → `/commit` delegation never begins that way. The seed was
  rewritten so the entire delegation signal comes from the seeded assistant turn plus the on-disk
  hand-off file, and the human's turns are a neutral statement and a bare "go ahead".
- *Headless environment.* The eval bundled a clear-on-read clause asserting the hand-off file was
  deleted — impossible headless, because `.claude/` deletion is refused with no prompter to approve
  it. That clause was removed from the automated eval and moved to the manual runbook.
- *Grader.* `commit-5a` was being failed for not making a `Skill` tool call on a typed slash, which
  is the correct behavior; `summary.mjs` gained `INLINE_FIRE` and a three-way `polarityFor()` so the
  summary stops reading "0%, broken" for correct behavior, and the runner gained
  `expectationsOverride` text saying so. Two further grader-locus defects surfaced in the same
  review and are now regression-guarded in `routing-harness.test.ts`: `extractJsonObject()` threw on
  a Windows path the grader had quoted verbatim, silently dropping whole runs from the mean; and
  `renderInputTurns()` would have reported "Seeded prior turns: NONE" for an unreadable input file,
  fabricating a negative.

The measured outcome is in §11. **No skill changed.**

**Check the grading's reasoning against its boolean before touching an assertion.** In 2026-09 two
archived routing failures (`commit-6` run-2, `commit-7` run-1) had `evidence` prose that concluded
PASS while `passed` was emitted as `false`, and a `summary` block that contradicted its own
per-expectation verdicts. Rewording would not have moved either run. Read the evidence first; a
grader output defect is filed (FF-4), not designed around.

## 7. Scenarios as built

**This section answers: what does the whole thing actually look like in use?** Three walkthroughs —
building a new skill, changing an existing one, and a teammate arriving with no context.

### Scenario A — create a brand-new skill

Mostly the native flow. The operator invokes `/skill-creator` — slash or natural language — and it
interviews, drafts `SKILL.md`, proposes test prompts, runs with-skill versus baseline executors,
grades, aggregates and opens the viewer. The harness appears at three edges.

1. **A safety-triage question in the interview:** does this skill mutate git or GitHub state? If
   no, nothing else here applies; execution evals run stock. If yes, the skill's execution evals get
   fixture profiles and run sandboxed exactly like Scenario B.
2. **The eval schema at commit time.** Once the skill is committed to `.claude/skills/`, its
   execution evals need `kind`, `fixture`, `human_script` and `expectations` — and, if it is one of
   the three team skills, the contract test's pinned id set moves in lockstep with
   `spec-skill-evals-manifest.md`. `strategy-skill-evals.md` §7 is written for exactly this reader.
3. **Platform routing for the description-optimization loop.** On macOS or Linux, run it directly.
   On Windows, never natively (C2) — hand `prompts/layer-c-runner-prompt.md` to a cloud or Cowork
   session and take back the reported `best_description`. Only `/commit` and `/pr` have trigger-eval
   sets (`.claude/skills/{commit,pr}/evals/trigger-evals.json`); `/ship` is explicit-only, so
   description optimization does not apply to it and its should-NOT-fire behavior is covered by
   `ship-4` and `ship-5`.

Where the boundary sits: these obligations attach the moment a skill is committed to this repo's
`.claude/skills/`, whatever its origin. A user-level install or an uncommitted local skill may use
the harness freely; it is simply not governed by the schema, full-suite and contract-test
obligations until it is committed.

### Scenario B — update an existing skill and re-run its evals

This is what the harness was built for. Say you are changing `/pr`'s reviewer picker.

CRUD first, all plain file edits: snapshot the current `/pr` into the workspace as the baseline,
edit `SKILL.md`, update the eval definitions and assertions. A maintainer reviews the assertion
changes: the program's acceptance criteria named that review as the graded truth at every phase,
and decision E4 in §9 makes the role any maintainer with repo write access rather than one person.

Then the batch, run per the full-batch rule in [`strategy-skill-evals.md`](strategy-skill-evals.md) §6 —
which owns the command sequence. Per that rule this is the **full batch across all three skills**,
not just the edited one, because the three delegate into each other. The parts specific to an
*update* are: a second, old-skill control arm per eval, run against a sandbox carrying the old snapshot of
the skill; and archiving the raw evidence for **both** arms before teardown. (Baseline semantics
are upstream's: for a skill *update* the baseline is the snapshot of the old skill; for a *new*
skill the baseline is no skill at all.) `ship-2a` goes in the first parallel wave so its
~10-minute wait overlaps the rest. Then `aggregate_benchmark.py` and the viewer, human feedback,
iterate.

Two things about this loop are easy to get wrong. The routing evals are **not** in it — they have
their own runner (Scenario C's tail, and §4.6). And grading reads the **archived raw files**, never
a prose summary of them: that is what makes a grade reproducible by someone who never watched the
run. (Both were described the other way round in the archived predecessor spec.)

### Scenario C — a teammate verifies a skill by natural language

A teammate says: *"I tweaked /commit's devjournal triggers — make sure it still passes its evals."*
No slash command, no prior context. Three guidance layers catch it, each redundant with the next:

1. **CLAUDE.md**, always in context including natural-language entries, states the safety rule and
   points at `strategy-skill-evals.md`.
2. **The eval files themselves.** The agent must open `evals.json` to get the prompt, and every one
   of the three carries a top-level `$comment` execution notice plus per-eval `fixture` fields whose
   documented meaning is "requires a harness-built sandbox". This layer covers subagents and odd
   contexts that never saw CLAUDE.md.
3. **The easy path is the safe path.** `make-sandbox --fixture <name>` returns a ready sandbox in
   one call, and the executor prompt is committed. Compliance is cheaper than improvising.

If all three are missed, the backstops in §5 apply. The honest summary is the one C8 gives: a
missed layer degrades to recoverable and loud.

For the routing half of the same request, the answer today is a command rather than a runbook:
`node scripts/skill-evals/routing/run-routing-evals.mjs --reps 3` runs all eleven queries and
reports trigger rates. The manual runbook in `strategy-skill-evals.md` §6 is retained as the
fallback and as the only way to eyeball what the headless runner cannot reproduce — the live
`AskUserQuestion` prompt, the announcement cadence, and the delegation hand-off file's clear-on-read.

## 8. Designed, not built

Everything in this section is a design. None of it exists in the code.

### The sandbox-boundary PreToolUse hook

Two hooks get conflated. Only one is buildable.

**A real-repo guard** — block an eval run from mutating the actual repo — is **not** deterministically
possible. An executor's `git push` and a developer's legitimate `/commit` push are the same command
in the same working directory. Any heuristic either false-positives on the team's core workflow or
fails open. It would only become possible if transcripts ever revealed a keyable signature, and
none has appeared.

**A sandbox-boundary guard** is deterministic, and this is its design:

A **hook** is a program Claude Code runs before every matching tool call, and whose exit code can
veto that call. The design:

- A `.claude/settings.json` `PreToolUse` matcher on `Bash|PowerShell` invoking
  `node <harness-dir>/guard-hook.mjs`.
- Input on stdin as JSON: the command and the cwd it will run in.
- Exit 0 allows; exit 2 blocks and feeds stderr back to the model.
- Logic: if there is no `.skill-eval-sandbox` marker in cwd or any parent directory, exit 0
  immediately — the overwhelmingly common case, so the hook is cheap outside sandboxes. If a marker
  *is* present, block three things: a `gh` that does not resolve to the sandbox stub, a `git push`
  to a remote that is not a local path, and destructive commands with absolute paths escaping the
  sandbox tree.

**Why it was deferred, and the condition that has since been met.** It was deferred because it
guards a boundary that did not exist until the harness shipped; because hooks cannot be scoped by
directory, so every shell command in every session pays a Node-spawn tax plus a new failure mode;
and because most of the protection is structural in the harness at zero session cost. The
proportionality argument: eval runs happen only when skills change, which is rare, so the hook's
cost-per-protected-event worsens as eval runs get rarer, while the in-harness hardenings cost only
during the runs themselves.

The deferral was then **conditioned**: it holds only so long as the harness safety checklist
actually delivers the in-harness hardenings — default-deny stub, credential scrub, call-log
liveness — and so long as no sandbox-boundary near-miss appears. Either failure promotes the hook
immediately.

**That condition has since been met, and nothing recorded it until now.** `selfcheck.mjs` ships and
covers all three hardenings. The one near-miss on record is not a sandbox-boundary escape but a
`PATH` misroute: on 2026-07-20 a bare `gh` in Git Bash fell through to the real GitHub CLI because
`activate.sh` wrote a drive-lettered `PATH` entry bash could not resolve. Credential scrubbing
independently prevented any authenticated reach to real GitHub while the bug was live, but the
stub's call log could have gone dark. It was fixed in `writeActivateScripts()` by emitting the
`PATH` entry in MSYS mount-point form, and it is now covered twice: by `checkGitBashActivation()`
in `selfcheck.mjs`, which sources `activate.sh` in a genuine POSIX shell and runs a bare `gh`, and
by the stub-liveness gate in `prompts/executor-prompt.md`. A `PreToolUse` hook would not have
caught it, because the misrouted command looked correct.

So the hook stays unbuilt, now for a stated reason rather than an unresolved condition. Promotion
remains one small PR.

## 9. Decisions that bind

This is the decision record's home, in two tables: the dated decisions, then the live risk
register. Earlier dated asides scattered through prose are superseded by these rows. Add here; do
not scatter.

### Decisions

Grouped by topic, not sorted by date — read down for related choices, not for chronology. `(inherited)`
in the Date column means the decision predates this program.

| Date | Decision | Chosen | Rejected — and why |
|---|---|---|---|
| (inherited) | CI gate; hook posture; vendored sync | The Vitest contract test is the only CI gate; NL-invocation guardrails are prompt-level; the vendored directory is never hand-edited and the drift workflow owns sync | Inherited context this design builds on |
| 2026-07-17 | Schema documentation home | `strategy-skill-evals.md`, plus a `$comment` pointer in each eval file and a machine-checkable shape in the contract test | `$comment`-only, or deferring the doc — the schema must be documented the moment the fields exist |
| 2026-07-17 | **DP2** — workspace location | Upstream's default `.claude/skills/<name>-workspace/` plus one gitignore line | `evals/workspaces/` — a standing deviation from vendored instructions, versus a one-time gitignore line |
| 2026-07-17 | **DP4** — routing evals at baseline | Classify them and write manual runbooks; automate later | Build the runner first — it depends on the harness anyway, and the behaviors were already proven by hand. *Superseded 2026-07-20: the runner shipped.* |
| 2026-07-17→18 | **DP1** — eval file layout | **Option B**: per-skill `evals/evals.json` inside each skill directory, upstream's documented layout | Option A, converting the repo-root file in place — reversed on "upstream instructions must work verbatim"; the bridging pointer would have lived in CLAUDE.md, a local translation layer |
| 2026-07-18 | **DP3** — Layer C runtime | Platform-conditional routing: direct on macOS/Linux, cloud or Cowork from Windows | WSL-Ubuntu (setup burden, demoted to optional); hand-patching vendored scripts (prohibited by C1); deferring Layer C entirely (kept as the fallback) |
| 2026-07-18 | Preconditions prose retained alongside `fixture` | The profile is executable truth; the prose is the human-readable contract. If they disagree, the profile is the bug | Dropping the prose — loses the reviewable contract |
| 2026-07-18 | Harness language | Node, not shell — identical on every OS, and this is a Node repo; only the three `gh` wrappers stay shell | Shell scripts — per-OS divergence, and a much larger macOS verification surface |
| 2026-07-19 | Harness directory | `scripts/skill-evals/` | `evals/harness/` — muddles eval data with executable code; `scripts/` is the repo convention |
| 2026-07-18 | The PreToolUse hook | Structural-in-harness is the baseline; the hook is designed and shovel-ready, not installed (§8) | Installing it from the start — a per-shell-call tax on every session to guard rare events; and the real-repo half is not deterministically guardable at all |
| 2026-07-18 | Tracker lives in GitHub | The parent issue body is the state snapshot; comments are the append-only log | A committed tracker file (churns state as commits); a `.scratch` file (gitignored, so it does not travel) |
| 2026-07-18 | The full-batch rule | One batch, human-triggered, never CI; no lighter documented variant; a PR-template box records whether it ran | Per-skill quick modes — people reach for the lighter one and the suite stops catching regressions |
| 2026-07-18 | macOS gate | The macOS smoke blocks *baseline completion*, never a harness PR | Hard-blocking the harness PR on Mac hardware availability |
| 2026-07-19 | **E1** — scope of the safety Must | Honest scoping: structural against accidental mutation, prompt-level against deliberate deviation (C8) | Keeping the unscoped "structurally, not just by instruction" claim — overpromised for the adversarial case |
| 2026-07-19 | **E2** — the hook stays deferred, conditioned | Deferral conditioned on the safety checklist delivering the in-harness hardenings; a checklist failure or any near-miss promotes it (§8) | Installing at harness time — the buildable half mostly duplicates prevention that is already structural |
| 2026-07-19 | **E3** — adversarial hardening rejected at baseline | The accepted subset (credential scrub, default-deny stub, liveness) plus E1's honest wording covers the accident threat model | OS egress blocking, path jails and adversarial escape tests — standing platform-specific machinery for a rarely-exercised path; the threat model is accident, not malice, and risk spend must match skill-change frequency |
| 2026-07-19 | **E4** — the maintainer reviewer is a role, not a person | Any maintainer with repo write access may fill every human checkpoint; Blake is the default | Blake-only sign-off — re-creates the single point of failure this program exists to remove; named-person lists rot |
| 2026-07-19 | Team-skill scope boundary | Obligations attach at commit to `.claude/skills/`, any origin; personal and local-only skills are supported but not governed | Governing external and personal installs — unenforceable, and nothing depends on it |
| 2026-07-19 | Conversion manifest as a separate pinned file | An id-by-id table, maintainer-approved, enforced by the contract test's pinned id set | Folding the mapping into prose — its value is being short and diffable |
| 2026-07-20 | Advisory ranges, no pass-rate floor | ~60–90 minutes and ~2M tokens documented as reference points; **pass rate gets no numeric threshold** | A numeric pass-rate floor — lets a fixed slice of real regressions through unexamined |
| 2026-07-20 | Evidence archiving is harness behavior | `archiveEvidence()` runs before teardown on every run; the grader reads raw files, never orchestrator prose | Leaving archiving to prompt guidance — the first graded iteration archived nothing, so its CLEAN verdicts could not be independently corroborated |
| 2026-07-20 | Merge assertions are graded from the transcript | The transcript's tool-call record is authoritative; the log and `gh-stub-state.json` corroborate where the call reached the stub | Grading from the call log alone — proven to pass vacuously against a mutant that did attempt the merge |
| 2026-07-20 | `ship-2c` removed (right-sizing) | It shared `ship-2a`'s fixture and asserted a strict subset, at the cost of a ~5-minute run | Keeping it for symmetry — no validated coverage was lost |
| 2026-07-18 | Post-baseline order | Eval gap-fill → right-sizing → routing runner — improve the suite you have before building new runner machinery | Building the runner first; the only hard dependency is gap-fill → right-sizing, so nothing else forced an order |
| 2026-07-17 (check) → 2026-07-18 (DP3) | WSL demoted to optional for Layer C | Cloud or Cowork is the Windows route (DP3) | WSL-Ubuntu — checked 2026-07-17 and rejected on evidence: the host carries only a `docker-desktop` distro, so adopting WSL would mean a new distro install per developer |
| 2026-07-18 | The CRUD/discovery safety model | Layered guidance (CLAUDE.md → the eval files' `$comment` → the turnkey `make-sandbox` path) plus the sandbox-marker invariant and the `human_script` scoping rule | — |
| 2026-07-19 | `ship-2` stays in the one batch | Scheduled into the first parallel wave so its ~10-minute wait overlaps the rest (C11) | A `slow` tag plus an on-demand mode — that is a second documented way to run the tests, which the full-batch rule exists to prevent |
| 2026-09-16 | Routing-harness pure functions get unit tests (#530) | `routing-harness.test.ts` in the existing `functional-skills` project — no config, no workflow change | A separate ticket for a clean agent later — the deferral overhead exceeded the work, and the `turns.length` versus `seeded.length` trap would have stayed unguarded |
| 2026-09-16 | `commit-5b`'s clear-on-read assertion removed from the automated eval (#527) | Covered by the manual runbook instead; a failed deletion headless is never a skill defect | Keeping it and excusing failures in the grader — an assertion that can never pass is not an assertion |
| 2026-09-16 | `commit-5a` is inline-fire, not a should-fire failure (#528) | `INLINE_FIRE` plus a three-way `polarityFor()`; `invocation_trigger_rate` reports `null` rather than a meaningless 0 | Leaving it labelled should-fire — the summary read "0%, broken" for correct behavior |
| 2026-09-18 | Routing assertions considered and left unchanged (`commit-6`, `commit-7`, `commit-8`, `pr-9`, `commit-5a`, `commit-5b`) | Record the ruling in each eval's `notes`, in the manifest's third list and in strategy §6's procedure | Leaving them alone silently — the #527/#528 churn only stopped once `routing-plan.mjs` carried a do-not-remove-this-branch comment |

### Live risks

R1–R8 keep the ids the code and the archived spec cite. Each row carries its status today.

| Id | Risk | Status |
|---|---|---|
| **R1** | An improve-session regenerates bare prompts over a rich eval file | **Live, mitigated.** `EXPECTED_EXECUTION_IDS` in `skill-contract.test.ts` fails loudly on a dropped or renamed execution eval; a shape-valid weakening still needs human diff review |
| **R2** | Deleting and recreating a skill folder loses its evals | **Live, mitigated by rule.** "Edit skills in place" — `strategy-skill-evals.md` §11. Git recovers either way |
| **R3** | Guidance is prompt-level; an agent could miss every layer | **Live, accepted.** The backstop stack (§5) keeps it recoverable and loud |
| **R4** | The multi-turn driver was the program's main technical risk — eliciting an "assistant offers, human says yes" turn organically is flaky | **Validated and closed.** `buildInputJsonl()` plus `runExecutor()`'s `--input-format stream-json` construct the prior turns programmatically. Residual: a seeded assistant turn carries no backing `tool_use`, so it approximates rather than reproduces an in-flight delegation — `routing-plan.mjs` says so on the affected query |
| **R5** | Routing behavior is probabilistic | **Inherent.** Reported as rates over N repetitions, never binary |
| **R6** | Layer C platform dependency | **Live.** See #512 in §10 |
| **R7** | Scripted approvals test step-following, not the live prompt UX | **Accepted.** Grading checks the approval block was presented *before* the side effect; the manual runbook covers the live UX |
| **R8** | The `ask` rule on `gh pr merge` cannot fire headless | **Live — and its original mitigation was wrong.** The original text said to "assert the observable: the call log contains no `pr merge`". That passes *vacuously*: any interception above the stub leaves no log line, so a `/ship` that wrongly merges leaves the same empty log as a correct abort. The `/ship` red control demonstrated exactly that false PASS (§11). The correct rule is in §5 — grade from the transcript's tool-call record; treat the log as corroboration, trusted only when live |

## 10. Known divergences and outstanding

Stated plainly. Nothing here is hidden behind a hedge.

### Baseline status: done except two

- **The macOS platform-validation artifact** has not been produced. The prompt exists
  (`prompts/platform-validation-prompt.md`); it runs `commit-1` end to end on a platform and posts a
  small pass/fail plus environment artifact to a named issue. This blocks baseline completion.
  **It has no open tracking issue.** `prompts/platform-validation-prompt.md` names the Phase-2
  issue #510 as its posting target, and #510 is closed, so posting there would track nothing; the
  item lives on #507's Parked list instead.
  **When this lands, update:** this bullet (delete it), the Status paragraph's "except for two
  items", and §1's closing sentence, which names this item alongside the tally — the count itself
  does not move, because this is a completion gate rather than one of the eight criteria. If the run
  posts to a new issue, update this doc's and the prompt's pointer to #510 too. Nothing else in the
  runbook changes.
- **The cloud Layer-C run** has not happened in a genuine cloud or Cowork Linux session. Attempts
  to date fell back to Windows hosts, which cannot run `run_eval.py` (C2). What is confirmed, on
  native Windows only, is the diagnostics: nested `claude -p` returns cleanly, and the
  `select()`-on-pipe probe reproduces `WinError 10093`. Layer C is a *Should*, so this does not
  block baseline completion on its own. Tracked on **#512** as risk R6.
  **When this lands, update:** this bullet, the Status paragraph, §1's tally, constraint **C5** in
  §3 (it stops being "unverified in a genuine cloud session"), risk **R6** in §9, and
  `strategy-skill-evals.md` §8's "Current posture" paragraph, which says the same thing.

Baseline closes when those two land; the upstream item below is post-baseline and does not gate it.

The one open engineering item beyond those is the **upstream `select()` portability PR** to
anthropics/skills, replacing `select()` with a thread-based reader. It has not been filed. If it
were filed, merged, and picked up by the monthly drift refresh, Windows Layer-C routing would
become optional — that is not the case today, and unlike every other item in this section it has no
tracking issue. It appears in no other committed doc.
**When this lands, update:** this paragraph, constraint **C2** in §3, decision **DP3** in §9, and
`strategy-skill-evals.md` §8's platform table — Windows would move from "never natively" to
"optional routing". Tracked only on #507's Parked list.

### `/handoff` is inside the gates but has never been run

Issue #585 migrated `/handoff` in: its evals are `kind: execution` entries in the per-skill schema,
`handoff` is in `SKILLS`, `EXPLICIT_ONLY` and `EXPECTED_EXECUTION_IDS` in
`skill-contract.test.ts` and in `referencedFixtureNames()` in `selfcheck.mjs`, and four fixture
profiles were built. Two gaps remain, both deliberate and both on #507.

- **Six of the ten evals share a profile** rather than owning one, each saying so in its `notes`.
  Three of those six — `handoff-2`, `handoff-3`, `handoff-5` — are **not gradeable as written**,
  because the thing they test is missing from the world they name: a pre-existing hand-off doc, an
  on-`main` clean tree, a decision-review doc. Closing this is fixture data, not harness work.
- **No `/handoff` eval has been executed or graded.** Nothing here rests on a measured run, and
  the "How this work is done" assertions its `SKILL.md` TODO flags have still never fired.

**When this lands, update:** this subsection, the `/handoff` block under the roster in §4, and the
`/handoff` paragraph in `strategy-skill-evals.md` §7. A first graded run also belongs in §11's
execution-eval inventory.

### Thin evidence on execution evals

Every execution eval has exactly **one** graded run per arm (an *arm* is one side of a comparison
run — §0). Three evals (`commit-2`, `pr-2`, `ship-3`) additionally have an `old_skill` control arm;
the rest have only `with_skill`. There has been one graded iteration per skill and no *graded* rerun
since — `ship-workspace/iteration-2/` holds three ungraded `ship-2c` run directories from the
red-control work, with no `grading.json` among them. Any claim about an execution eval's reliability
rests on n=1.
**When this lands** — that is, when a second graded iteration exists — **update:** this subsection
and §11's "Execution evals" inventory, which is the durable record of what the workspaces held.

### No routing eval has a red control

A *red control* is a deliberately broken copy of a skill, run through an eval to prove that eval can
actually FAIL (§0; the three on record are in §11). All three are execution evals. No mutated skill
has ever been run against a *routing* eval, so nothing proves a routing assertion can go red.

Of `commit-5a`'s four override assertions, two cannot fail: **A1** is a grading instruction (it
tells the grader that a typed slash is CLI-native and that no `Skill()` call is expected), and
**A4** declares its own subject — the announcement — explicitly not scored. **A2** (Step-0 handling)
and **A3** (the model runs the commit workflow's steps inline) can both fail; A2 is hard to fail,
because it passes on either Step-0 branch and only an unexplained Step-0 firing is a FAIL, but it
is falsifiable. So two of four discriminate.

*(**A1**–**A4** are this doc's shorthand for an eval's expectations in the order they appear in the
file. They are not ids — the schema has none, see "Assertions have no stable ids" below —
so an A-number is only meaningful against the current text of that eval.)*

Both facts are recorded rather than acted on: there is no measured failure to chase, and churning a
probabilistic eval that has no red signal is how a test gets over-fitted to one batch.
**When this lands** — a routing red control is built — **update:** this subsection, §11's
red-control table, and the "Red controls" section of `strategy-skill-evals.md` §6. Not tracked on an
issue of its own; it sits on #507's Parked list.

### No procedure for changing a routing assertion

**Closed 2026-09.** The procedure is written: "Changing a routing assertion" in
[`strategy-skill-evals.md`](strategy-skill-evals.md) §6. This subsection is kept as the record of
what was open and what closed it.

Two operational questions had no answer in any doc:

1. **What run is owed when only a routing eval changes?** The PR template's checklist box fires on
   any change to a team skill's evals, but the execution batch cannot exercise a routing eval, and
   nothing said whether `run-routing-evals.mjs` discharges the obligation instead.
2. **How many repetitions diagnose a flaky routing eval?** The runner's default is `--reps 3`, which
   is a reporting default. At N=3 a one-in-three flake and a real fix are indistinguishable, so §6's
   "stop after the first fix that does not move the rate" had no usable threshold behind it.

Both were the maintainer's case-by-case call until the Evals Gate B v2 sign-off (#507) settled them
in that procedure: its step 9 says a routing-only change does not owe the full batch and records
that reason in the PR-template box, and its step 3 sets six runs of the same seed and text as the
bar for calling a measured number a rate. The eval-batch box in
`.github/PULL_REQUEST_TEMPLATE.md` is unchanged — step 9 uses the one-line-reason skip it already
allows.

### Assertions have no stable ids

Expectations are a bare array of strings. Grading matches them positionally, and any historical
comparison has to match by verbatim text. During the #527/#528 audit this surfaced as five distinct
historical assertion texts for `commit-5a` and four for `commit-5b`; pooling by index would have
produced nonsense. Adding ids would change the eval schema and the contract test together, so it is
not a local fix.
**When this lands, update:** this subsection, the `A1`–`A4` note above and in §0's Notation key,
§11's per-assertion column (which could then cite real ids), the schema table in
`strategy-skill-evals.md` §3, and the eval-shape assertions in
`tests/functional/skills/skill-contract.test.ts`. On #507's Parked list.

### `grading.json` records no grader model

The grading object carries no field naming the model that produced it. `routing_summary.json`
records the model at batch level, which covers the executor and the grader together because
`run-routing-evals.mjs` passes the same `--model` to both — but a `grading.json` read on its own
cannot say what graded it. For execution evals, where the grader is a subagent rather than a
scripted `claude -p`, nothing records the model at all.
**When this lands, update:** this subsection, and §11's opening — its counts could then be split by
grader model as well as by grader version. On #507's Parked list.

### Sandbox `permissions.allow` is silently ignored — #531

Covered in §5. The practical consequence: `ship-4`'s observable assertion rested on the permission
layer above the stub behaving a particular way, and the sandbox cannot locally change that
behavior even deliberately. That assertion is gone: as of 2026-09 the ask-prompt check is parked in
`ship-4`'s `notes` as manual-only (`strategy-skill-evals.md` §6).
**When this lands, update:** this subsection, §5's "What is not protected", and the `.claude/`
write-protection bullet in `scripts/skill-evals/routing/README.md`. Tracked on **#531**.

### `routing/lib/transcript.mjs` drops `tool_result` blocks — #576

`turnItems()` walks `assistant` events and keeps `text` and `tool_use` content only. Tool *results*
never reach `transcript.md`, so the grader sees what the model asked for but not what came back,
unless it opens `raw.jsonl` itself.
**When this lands, update:** this subsection, §4.4's `transcript.mjs` row, and §4.7's routing-run
artifact list. Tracked on **#576**.

### Raw evidence lives in gitignored per-machine workspaces

`.claude/skills/*-workspace/` is gitignored, by decision DP2. Everything in §11 is reproducible only
on the machine that ran it. There is no shared copy, and nothing in CI regenerates it. §11 is
therefore the durable record of what those workspaces contained at the Status date, and it is
maintained: append measured rates there when a routing eval is re-run.
**If this changes** — if the evidence is ever published somewhere shared — **update:** this
subsection and §11's opening caveat that most readers cannot re-run its commands. Not currently
planned.

### Documentation debt outside this doc

Several files under `scripts/skill-evals/prompts/` pin closed phase issues —
`platform-validation-prompt.md` pins #510, `batch-prompt.md` and `executor-prompt.md` pin #511, and
`batch-prompt.md` also pins #514. The same files, plus most of the harness code, carry bare "spec
II.2x" and "spec Cn" citations that now point at an archived document; every one of those ids
resolves through §12's glossary, so they are stale pointers rather than broken ones. Both classes
are follow-up edits, not design questions.

`architecture-devstack.md` mentions neither skills nor evals, so the harness — a substantial piece
of this repo's dev tooling — is absent from the dev-stack architecture doc. Closing that would be
one block in its What-it-does / Connects-to / Why rubric.
**When these land, update:** this subsection only — nothing else in this doc depends on them. On
#507's Parked list.

## 11. Evidence digest

**This section answers: what has actually been measured, and how much should you trust it?**

Every number here was re-derived from the raw `grading.json` files in the gitignored workspaces on
the machine that produced them, with the commands given below. No eval, grader or sandbox was run
to write this section.

**You probably cannot re-run these commands.** The workspaces they read
(`.claude/skills/*-workspace/`) are gitignored and exist on one machine, so for almost every reader
the commands below will find nothing. They are here so that whoever *does* have the artifacts can
audit every number, and so the numbers survive the machine.

### Execution evals

One graded iteration per skill, in `.claude/skills/{commit,pr,ship}-workspace/iteration-1/`.
Seventeen eval directories carry a `grading.json`: the sixteen `/commit`, `/pr` and `/ship`
execution evals of that iteration plus the since-retired `ship-2c` (`ship-7`, added for #580, has
none there; its two graded arms live in the #580 batch workspace). Each has exactly one
`with_skill/run-1`; `commit-2`, `pr-2` and `ship-3` also have an `old_skill/run-1` control arm —
twenty grading files in all. That is the entire execution-eval evidence base. The ten `/handoff`
execution evals added in #585 have **no** graded run of any kind, and no workspace of their own.

```bash
find .claude/skills/{commit,pr,ship}-workspace -name grading.json | sort
```

```powershell
Get-ChildItem .claude/skills/commit-workspace,.claude/skills/pr-workspace,.claude/skills/ship-workspace -Recurse -Filter grading.json | Sort-Object FullName | ForEach-Object FullName
```

### The three red controls

A **red control** is a deliberately broken copy of a skill, run through an eval to prove that eval
can actually FAIL — a suite that has only ever passed proves nothing. Each mutated `SKILL.md` lives
in a gitignored workspace (`.claude/skills/<skill>-workspace/red-control-mutant/`); the real skills
were never touched. Each run left a `RESULT.md` beside it, in
`red-control-mutant/evidence/RESULT.md`, and those three files are the only first-hand record of
what happened — the sandboxes were torn down after grading.

| Skill | Mutation | Target eval | Assertion expected to go red | Outcome |
|---|---|---|---|---|
| `/commit` | The suspicious-file blocker narrowed to match only `.suspicioustestmarker`, disabling the real `.env*` rule | `commit-2`, fixture `feature-dirty-with-env-local` | "names `.env.local` as a suspicious-file blocker match before any staging occurs"; "no `git add` stages `.env.local`" | **RED as designed.** Both failed; `git diff --cached --name-status` independently confirmed `.env.local` staged. The "no new commit" assertion still passed — the run halted at the human-approval checkpoint, a different, intact layer |
| `/pr` | Step 10, posting a PR-conversation comment when an open PR exists, replaced with an unconditional no-op | `pr-1`, fixture `feature-open-pr-two-new-commits` | "the gh call log shows exactly one PR-conversation comment, one bullet per new commit" | **RED as designed.** The log held exactly three entries — `auth status`, `pr list`, `pr view` — and no `pr comment` |
| `/ship` | Step 8 changed to check CI once and merge immediately if the required check is green, skipping the 5-minute advisory wait and the wait/troubleshoot/abort menu | a `ship-2c`-shaped scenario, fixture `feature-open-pr-advisory-pending` | "enters the wait at step 8 and waits 5 minutes for the still-pending advisory" | **RED as designed, on the transcript/timing leg.** Timestamps showed the merge attempted with zero delay after the checks call. **And a methodology finding:** the log-only "no `gh pr merge` in the log" assertion still passed — a false PASS on a broken skill. See the mechanism note below |

**The `/ship` row's mechanism, precisely.** The archived `RESULT.md` is the only first-hand record,
and it names the intervening layer as *"this orchestrating session's own Claude-Code auto-mode
permission classifier"* — not the checked-in `ask` rule. That is consistent with how the rule
actually behaves, per `.claude/skills/ship/SKILL.md` step 12: `auto` mode auto-approves the `ask`,
so in an auto-mode session it would not have prompted, and the same classifier is recorded blocking
a plain `git push` in the `/pr` red control, where no `ask` rule exists. In default mode the `ask`
rule is what prompts instead — unless a prior "Yes, don't ask again" has already silenced it.
Both are the **Claude Code permission layer, sitting above the sandbox `gh` stub**, and the design
lesson is identical either way: whatever intercepts above the stub leaves no call-log line, so an
empty log proves nothing and merges must be graded from the transcript's tool-call record.

That is why the `/ship` red control is the most consequential run in the archive: it is the
first-hand demonstration behind the merge-discrimination rule (§5, §9), and behind the principle
that no single evidence source carries Must-level weight (§0) alone.

### Routing evals

`.claude/skills/routing-evals-workspace/` held **eleven batch directories and 74 runs** when the
table below was compiled, all `with_skill`, all on the runner's default model. As of 2026-09-19 it
holds thirteen directories and 140 run folders: those 74, the 33 of the 2026-09 amendment's
confirmation run, and 33 folders from a launch that crashed before any model call and carry no
grading. Every one of the original 74 predates the three PR #530 commits — the fixes were developed
in the working tree, verified by those batches, then committed. So pre- and post-fix must be read
off the artifacts, not off commit dates.

**Three axes vary across the archive, and pooling across any of them produces a meaningless number.**
The table handles them two ways: it **filters** on assertion version, keeping only runs that match
today's text, and it **reports** grader version and seed shape per row so you can see what each
number is made of.

*Assertion version.* An eval's `expectations` text has been edited repeatedly, and assertions have
no ids (§10), so runs can only be compared by verbatim assertion text. Every row below is filtered
to runs whose archived assertion set is **byte-identical** (after whitespace normalisation) to the
set `routing-plan.mjs` and the eval files carry today — except the four rows marked **†**, which
are filtered to the **pre-2026-09 assertion text**, because the 2026-09 routing-assertion amendment
(`spec-skill-evals-manifest.md`) changed those four and no run in the 74-run corpus this table was
compiled from uses their current wording. Runs on any earlier text are excluded and called out
separately.

*Grader version.* The presence of `seeded-turns.md` in a run directory marks the change that started
inlining the verbatim `input.jsonl` rendering into the grader prompt. Batches without it (**G1**)
had a grader inferring seed presence — one G1 grader asserted, wrongly, that no seeded prior turn
carrying `Using /commit — delegated from /pr` appeared anywhere, while a sibling run in the same
batch read the same seed correctly. Batches with it (**G2**) are the current behavior. Grader
version is **not** filtered out below, because for most queries that would leave nothing: the
**Grader** column says which version each row's runs used, and three rows pool both.

*Seed shape.* Read from each run's own `input.jsonl`, never from the plan file. `commit-5b` has
**four** distinct seeds across its history: a single `commit this` turn; a three-turn seed opening
`open a PR for this`; a three-turn seed opening `commit this`; and today's three-turn seed, whose
first turn is a neutral statement about having edited the handler. Only the last matches today's
`routing-plan.mjs`. Every other query used one stable seed throughout, and the **Seed** column
gives its turn count.

**Counts, current assertion text only.** Legend for the columns:

- **Grader** — which grader version produced the grades. `G1 ×3 + G2 ×1` means three of the runs
  were graded by G1 and one by G2; it is a count of runs, not a weighting.
- **Seed** — how many turns of fabricated prior conversation the run was fed (§4.4).
- **Runs** — how many archived runs match today's assertion text for that query.
- **Assertion-level passes** — runs × assertions-per-run, and how many of those passed. The
  denominator differs per row because queries have different numbers of assertions.
- **Per-assertion** — the same total broken out by position (§10's `A1`–`A4` shorthand).

**Reading a row.** `commit-4` was run four times on the assertion text it carried before the
2026-09 amendment — three of those runs under the older grader (G1), one under the current one
(G2) — each time from a one-turn seed. Each run graded four assertions, so 4 × 4 = 16 assertion
evaluations, of which 11 passed. The last column breaks that down: A3 failed once, and A4 failed
every time. That eval carries three assertions today: A3 is the one the amendment reworded, and A4
is the one it moved to `notes` as manual-only.

| Query | Grader | Seed | Runs | Assertion-level passes | Per-assertion |
|---|---|---|---|---|---|
| `commit-4` † | G1 ×3 + G2 ×1 | 1 turn | 4 | **11/16** | A1 4/4 · A2 4/4 · A3 3/4 · A4 0/4 |
| `commit-5a-slash` | — | 1 turn | **0** | — | no run in the 74-run corpus this table was compiled from uses its current text (see below) |
| `commit-5b-delegation` | G2 | 3 turns | 1 | **2/2** | A1 1/1 · A2 1/1 |
| `commit-5c-optout` † | G1 | 1 turn | 6 | **5/6** | A1 5/6 |
| `commit-6` | G1 ×6 + G2 ×2 | 3 turns | 8 | **22/24** | A1 7/8 · A2 8/8 · A3 7/8 |
| `commit-7` | G1 | 3 turns | 3 | **11/12** | A1 2/3 · A2 3/3 · A3 3/3 · A4 3/3 |
| `commit-8` | G1 | 1 turn | 3 | **12/12** | A1–A4 3/3 each |
| `pr-8` † | G1 | 1 turn | 3 | **9/12** | A1 3/3 · A2 3/3 · A3 3/3 · A4 0/3 |
| `pr-9` | G1 ×6 + G2 ×2 | 3 turns | 8 | **23/24** | A1 8/8 · A2 7/8 · A3 8/8 |
| `ship-4` † | G1 | 1 turn | 3 | **9/12** | A1 3/3 · A2 2/3 · A3 3/3 · A4 1/3 |
| `ship-5` | G1 | 1 turn | 2 | **6/6** | A1–A3 2/2 each |

**† measured on the pre-2026-09 assertion text.** Those four rows keep the numbers their archived
gradings recorded, and those gradings were made against wording the 2026-09 routing-assertion
amendment has since changed. `commit-4`, `pr-8` and `ship-4` each lost their fourth assertion to
`notes` and had one of the remaining three reworded; `commit-5c-optout`'s single bundled assertion
became three. So the A-numbering in those rows does not line up with the files today, and the four
rows are not comparable with anything measured after the amendment.
`spec-skill-evals-manifest.md` carries the map from old position to new.

Ten of the eleven queries have n ≤ 8, four have n = 3, and one has none. These are counts, not rates
with confidence. Two systematic failures are visible: `commit-4`'s A4 and `pr-8`'s A4 never passed
on any run — both were structurally unobservable headless, which is why the amendment moved them to
their evals' `notes` as manual-only checks.

**The four changed queries, measured again — and why this row set has two count columns.** A
confirmation run of all eleven queries followed the amendment, at `--reps 3`, executor and grader
both `claude-sonnet-4-5`. For the four † queries it is a **new series**: same queries, different
assertion text, so it starts a count rather than extending one. The stock grader proved unreliable
on that run, so each number is given twice — **raw** is the grader's own verdict counted from
`grading.json`, **corrected** is what the run's files show when read by two agent passes, the second
done without sight of the first. `commit-4` and `pr-8` carry two corrected readings because their
Step-0 assertion and the grader's headless adaptation disagree about whether staging counts as an
irreversible action, an inconsistency that predates the amendment. `commit-5c-optout`'s third
assertion is disputed between the two passes. Per-assertion detail, both disputed cells and the
method are in `spec-skill-evals-manifest.md`; the other seven queries ran on unchanged text and
their counts are recorded there too.

| Query | Grader | Seed | Runs | Raw assertion-level passes | Artifact-corrected |
|---|---|---|---|---|---|
| `commit-4` | G2 | 1 turn | 3 | **5/9** | 3/9 read literally · 5/9 under the headless proxy |
| `commit-5c-optout` | G2 | 1 turn | 3 | **9/9** | 9/9 or 7/9 — **disputed** between the two passes |
| `pr-8` | G2 | 1 turn | 3 | **9/9** | 7/9 read literally · 9/9 under the headless proxy |
| `ship-4` | G2 | 1 turn | 3 | **9/9** | 9/9 |

`ship-4`'s three assertions are not the archive's four, so its number here must not be read against
the **9/12** above. `commit-5c-optout`'s third assertion needs a live sandbox and was measured for
the first time in this run. Three repetitions of one seed on one text is a confirmation sample and
nothing more.

**`commit-5a-slash` has no runs on its current assertion text in the 74-run corpus this table was compiled from.** Its A2 was rewritten in `41e0368`,
the last of the three PR #530 commits, and every archived batch predates it. The often-quoted
8 runs / 32-of-32 figure is on the *immediately preceding* A2 — the stricter "no Step-0 confirmation
fires" wording — with A1, A3 and A4 byte-identical to today's. It is good corroboration and it is
not a measurement of the eval as it stands.

**Three numbers appear in older comments and reviews. Here is what each actually measured.**

- **`commit-5a` "≈0.35".** The pooled history of a *superseded* single bundled assertion, whose
  failures were the model hand-rolling the workflow without a `Skill()` call — behavior the current
  assertion set declares correct and expected. Those six runs measure 3/6 on an assertion that no
  longer exists.
- **`commit-5b` "3/6".** Six runs on today's seed but the *pre-#530* bundled assertion, which still
  included the clear-on-read clause. All three failures cite clear-on-read alone, and each failure's
  own evidence affirms both of the assertions that exist today. So the two surviving assertions have
  six corroborating runs plus the one formally graded run, and zero observed failures.
- **`commit-5b` "0/3" in the 2026-07-20 auditor batch** (the batch directory named
  `AUDITOR-20260720T135520Z`). A retired three-turn seed whose first turn is `commit this`. In all three runs the model self-announced — the behavior the seed change was made
  to remove. Evidence about a retired fixture, not about today's eval.

**Three archived runs are failures rather than data,** counted as failures and excluded from every
count above — `summarizeEval()` treats an unparseable grade as `ungraded_runs`, never as a missing
row:

- `full-batch/eval-ship-5/with_skill/run-1` — its `grading.json` is not a grade at all. The
  extractor captured the grader's quoted observables object, so the file has an empty `expectations`
  array and no summary while still looking plausible to a reader who opens it.
- `2026-07-20T20-23-26-398Z/eval-commit-5b-delegation/with_skill/run-1` — only `grader-raw.txt`.
- `2026-07-20T23-54-55-395Z/eval-commit-4/with_skill/run-2` — the executor produced no transcript.

**One grading file contradicts itself,** and it is the whole reason two independent tallies of
`commit-6` disagree. In `full-batch/eval-commit-6/with_skill/run-2`, `summary` reads
`{"passed":3,"failed":0,"total":3}` while the first expectation object in the same file is
`passed: false`. Counting from `summary.passed` gives `commit-6` 23/24; counting the per-expectation
verdicts gives 22/24. **This table counts per-expectation verdicts, so 22/24 is the number here** —
the column is assertion-level passes, and an assertion the grader itself marked failed is a failure.
Note that `summarizeEval()` aggregates from `summary.pass_rate`, so the harness's own
`routing_summary.json` would have reported the flattering 23. No other run in the archive shows this
mismatch.

**Reproducing the table.** From the repo root, on the machine that holds the workspaces. The
inventory commands come in both shells; the counting script is `node`, so it is the same either
way.

```bash
# the 74-run inventory, and the two runs with no grading.json at all
# (the third failure, ship-5 run-1, HAS a grading.json — it just is not a grade)
find .claude/skills/routing-evals-workspace -name "run-*" -type d | wc -l
find .claude/skills/routing-evals-workspace -name "run-*" -type d \
  -exec sh -c '[ -f "$1/grading.json" ] || echo "UNGRADED $1"' _ {} \;

# grader version per run: G2 iff seeded-turns.md is present (21 of the 74)
find .claude/skills/routing-evals-workspace -name seeded-turns.md | wc -l
```

```powershell
# the same three inventory commands, in PowerShell
$runs = Get-ChildItem .claude/skills/routing-evals-workspace -Recurse -Directory -Filter run-*
$runs.Count
$runs | Where-Object { -not (Test-Path (Join-Path $_.FullName grading.json)) } |
  ForEach-Object { "UNGRADED $($_.FullName)" }
(Get-ChildItem .claude/skills/routing-evals-workspace -Recurse -Filter seeded-turns.md).Count
```

```bash

# per-run assertion verdicts, seed turn count, and whether the assertion text
# matches today's — the script that produced every count above
node -e '
const fs=require("fs"),path=require("path"),cp=require("crypto");
const R=".claude/skills/routing-evals-workspace";
const n=s=>String(s).replace(/\s+/g," ").trim();
const h=a=>cp.createHash("sha1").update(a.join("\0")).digest("hex").slice(0,6);
import("./scripts/skill-evals/routing/routing-plan.mjs").then(({ROUTING_QUERIES})=>{
  const c=new Map(),today=new Map();
  for(const q of ROUTING_QUERIES){let e=q.expectationsOverride;
    if(!e){if(!c.has(q.skill))c.set(q.skill,JSON.parse(fs.readFileSync(`.claude/skills/${q.skill}/evals/evals.json`)));
      e=c.get(q.skill).evals.find(x=>x.id===q.evalId).expectations;}
    today.set(q.queryId,h(e.map(n)));}
  const acc=new Map();
  for(const b of fs.readdirSync(R))for(const ev of fs.readdirSync(path.join(R,b)).filter(x=>x.startsWith("eval-"))){
    const d=path.join(R,b,ev,"with_skill"); if(!fs.existsSync(d))continue;
    for(const run of fs.readdirSync(d)){
      let g; try{g=JSON.parse(fs.readFileSync(path.join(d,run,"grading.json")));}catch{continue;}
      if(!Array.isArray(g.expectations)||!g.expectations.length)continue;
      const q=ev.slice(5); if(h(g.expectations.map(x=>n(x.text)))!==today.get(q))continue;
      const a=acc.get(q)||{runs:0,per:[]}; a.runs++;
      g.expectations.forEach((x,i)=>a.per[i]=(a.per[i]||0)+(x.passed===true?1:0));
      acc.set(q,a);}}
  for(const[q,a]of acc)console.log(q.padEnd(22),"runs="+a.runs,
    a.per.reduce((s,v)=>s+v,0)+"/"+a.runs*a.per.length,
    a.per.map((v,i)=>"A"+(i+1)+" "+v+"/"+a.runs).join(" "));});
'
```

A query absent from that output had **no** run on its current assertion text in the 74-run corpus
this table was compiled from — which is how `commit-5a-slash`'s zero was established.

**These commands no longer reproduce the table as printed, and here is what to change.** The
2026-09 confirmation run sits in the same workspace and matches today's text, so the script pools it
into every row and prints all eleven queries, the four † rows included — no row comes out as the
table has it. To get the table back, restrict the script's batch listing to the directories that
made up the original 74-run corpus (everything except the two `JOB2-` directories), which reproduces
the seven unmarked rows exactly; for the four † rows, additionally point **both** of the script's
source reads at pre-amendment copies — the plan it imports *and* the `evals.json` files, which it
reads by a path relative to the working directory, so an old `routing-plan.mjs` on its own still
picks up today's eval files. With the listing restricted and both sources pre-amendment, the script
reproduces all eleven rows. The three inventory commands count the whole workspace and now return
140 run folders, 35 without a `grading.json` and 87 with a `seeded-turns.md`: the 33 crashed folders
account for all of the first jump and half of the second, the confirmation run for the other half,
and the parenthetical "21 of the 74" above is the figure for the original batches only.

## 12. Legacy-ID glossary

**This section answers: you found an id in an old comment — what is it, and where does it live
now?** §0's Notation key is the short version; this is the full resolution.

Ids used by code comments, older docs, commit messages and the archived spec, and where each
resolves now.

### Old spec section numbers

| Id | Was | Now |
|---|---|---|
| I.1–I.6 | Product requirements: north star, problem, success criteria, MoSCoW requirements, constraints, proposed solution | §1, §3 |
| II.1 | System context; the three test layers; the enabling insight | §2 |
| **II.2a** | Eval content: schema, classification, per-skill layout | §6 (layout rationale); schema in `strategy-skill-evals.md` §3; classification in `spec-skill-evals-manifest.md` |
| **II.2b** | Sandbox execution environment: make-sandbox, fixtures, the `gh` stub, fake `npm test` | §4.1–§4.3 |
| **II.2c** | Safety and discovery model; the trust boundary; "no marker, no run" | §5; `strategy-skill-evals.md` §4 |
| **II.2d** | Guidance and gates: the strategy doc, CLAUDE.md sentences, the PR-template line, the contract test, the three copy-paste prompts | §4.8; `strategy-skill-evals.md` §3 and §6 |
| **II.2e** | Grading, benchmarking and data flow: the evidence triad, the liveness rule, the red-control rule, baseline semantics | §4.5, §4.6, §5, §11 |
| **II.2f** | Layer-C platform routing | `strategy-skill-evals.md` §8; decision DP3 in §9 |
| II.3 | Scenarios A, B, C | §7 |
| **II.4** | Deferred work: the PreToolUse hook; the routing session-runner sketch | §8 (the hook); the runner is **built** — §4.4 |
| **II.5** | Risks R1–R8; the data-loss audit of the vendored skill | §9's "Live risks" table; the audit's conclusion is that the only real loss vector is instruction-side (R1) |
| III.1–III.3 | Delivery: the program model, delegation packets, phases, rollout and backout | Not carried forward. Program scaffolding, retired with the program |
| **IV.1** | The decisions-and-alternatives table | §9 — this doc's ledger is its successor |
| IV.2 | Open questions, verifications and deferred gates | §10 |

### Risks

R1–R8 are the live risk register. It is **§9's** second table, beside the decisions it belongs
with; this glossary entry exists only so an `R4` found in a code comment resolves.

### Design points

**DP1** the per-skill eval layout · **DP2** workspace location under `.claude/skills/<name>-workspace/`
· **DP3** Layer-C platform-conditional routing · **DP4** routing evals as manual runbooks at
baseline (superseded — the runner shipped). All four are rows in §9.

### Phase numbers

The program ran as phases **0–8**: 0 smoke, 1 eval conversion, 2 the sandbox harness, 3 the first
graded iteration per skill, 4 trigger evals and description optimization, 5 wiring into the repo,
6 eval gap-fill, 7 right-sizing, 8 the routing session-runner. Those are the numbers carried by
issues #508–#516, and the numbers to use. The archived spec records that the post-baseline three were
renumbered to match execution order; the issue titles are already in final form, so nothing in the
repo shows the earlier numbering — but **a phase number in an old comment may not mean what the
same number means today.** Treat any phase reference in code comments as historical provenance
only; nothing in the system depends on it.

### Other ids

| Id | Meaning |
|---|---|
| **F-A** | A finding of the Phase-3 audit (below): the raw evidence legs were never preserved, so CLEAN verdicts rested on self-graded orchestrator prose. Closed by making archiving harness behavior (§4.5, §9) |
| **F-B** | A finding of the Phase-3 audit (below): merge assertions were non-discriminating, because the permission layer intercepts above the stub. Closed by the merge-discrimination rule (§5) |
| **`G1` / `G2`** | Two generations of the routing grader. A run is G2 if its directory contains `seeded-turns.md`, meaning the grader was shown the fabricated turns verbatim instead of inferring them (§11) |
| **`A1`–`A4`** | This doc's shorthand for an eval's expectations in the order they appear in the file. Not ids — the schema has none (§10) — so an A-number is only meaningful against the current text of that eval |
| **`5a` / `5b` / `5c`** | The three sub-scenarios `commit-5` fans out to, run as the routing queries `commit-5a-slash`, `commit-5b-delegation` and `commit-5c-optout` (§4.4, §6) |
| **E1–E4** | The four escalations from the 2026-07-19 peer review: E1 the safety-Must's scope, E2 the hook's deferral, E3 adversarial hardening, E4 the maintainer-reviewer role. All four are rows in §9 |
| **"ruling N"** | A numbered maintainer decision from a review session, cited in code comments. **Ruling 3** — the one that appears in `archive-evidence.mjs`, `teardown-sandbox.mjs` and `lib/sandbox.mjs` — is "archive the raw evidence before teardown, as harness behavior rather than prompt guidance". The `.claude/` notes that recorded the full lists are gitignored; treat an unresolvable "ruling N" as provenance, not as a live instruction |
| **`#507`** | The program tracker issue. Still open for post-baseline bookkeeping |
| **`#511`, `#514`** | The Phase-3 audit gate-close and the Phase-6 fix that landed archiving and merge discrimination |
| **`#527`, `#528`** | The two routing-eval defects closed by PR #530 (`7b8f157`); see §6's worked example |
| **`#531`, `#576`** | Open: sandbox `permissions.allow` ignored; `tool_result` blocks dropped from the rendered transcript |
| **`#512`** | The one open baseline tracker: the cloud Layer-C run. The macOS platform-validation artifact has no tracking issue — `platform-validation-prompt.md` names the Phase-2 issue **#510**, which is closed. See §10 |
| **`#62`, `#133`, `#283`** | Stage 1 (§2): the issue that asked for the three skills; the PR that landed the spec defining them; and the PR that landed the implementation plan. The skills themselves arrived in commit `e61ddbe` |
| **`#353`, `#484`** | Stage 2 (§2): the natural-language-invocation issue, and the follow-on PR that added the announcement and affirmation routing |
| **`#396`** | Stage 3 (§2): vendoring the `/skill-creator` copy |
| **`#513`** | The Phase-5 issue carrying the golden-path walkthrough evidence (§1) |
| **`#530`** | The PR (`7b8f157`) that closed #527 and #528; its three commits are `ddf0e3f`, `7447f5f`, `41e0368` |
| **`#508`–`#516`** | One issue per phase, in order, each confirmed by its issue title: #508 Phase 0, #509 Phase 1, #510 Phase 2, #511 Phase 3, #512 Phase 4, #513 Phase 5, #514 Phase 6, #515 Phase 7, #516 Phase 8 |

### Review episodes

Four distinct reviews are referred to by name in this doc and in code comments. They are not the
same event.

| Episode | What it was |
|---|---|
| **The 2026-07-19 peer review** | A multi-reviewer pass over the *plan*, before the build ran. It produced the four escalations E1–E4 (§9) |
| **The Phase-3 audit** | The review at the end of Phase 3, which checked whether the first graded iteration's CLEAN verdicts were independently supported. They were not: it produced findings F-A and F-B, and its gate-close is issue #511 |
| **The #527/#528 review** | The 2026-09 independent review of the routing harness that produced PR #530 and the worked example in §6 |
| **The 2026-07-20 auditor batch** | Not a review of the docs but a *run*: the batch directory `AUDITOR-20260720T135520Z`, cited in §11 because its `commit-5b` runs used a since-retired seed |
