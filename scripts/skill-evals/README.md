# skill-evals sandbox harness

A disposable sandbox harness for **executing** this repo's Claude Code skill evals
(`/commit`, `/pr`, `/ship`) without ever touching the real repo or real GitHub. It builds a
throwaway git repo per named fixture, shadows `gh` with a logging **default-deny** stub,
fakes `npm test`, and scrubs credentials — so a skill eval can stage, commit, push, open a
PR, and "merge" against a world that is physically separate from your checkout.

- **Design & rationale:** [`docs/spec-skill-evals-baseline.md`](../../docs/spec-skill-evals-baseline.md) (§II.2b, §II.2c).
- **How to run evals / the safety model / the schema:** [`docs/strategy-skill-evals.md`](../../docs/strategy-skill-evals.md).
- This README is the harness-internals reference: what each piece is and how to drive it.

Node core, zero runtime dependencies; only the three thin `gh`-stub wrappers are shell. The
Node engine floor is pinned in [`package.json`](./package.json) (`engines.node >= 20`) and
enforced at runtime.

## The one rule

Skill-eval prompts are **never** executed against the real repo or real GitHub — any skill,
any origin. Execution happens only inside a harness-built sandbox that carries a
`.skill-eval-sandbox` marker. Everything else about a skill (reading it, editing `SKILL.md`,
writing evals) is a plain file edit, safe anywhere.

## Quick start

```sh
# List the fixture profiles.
node scripts/skill-evals/make-sandbox.mjs --list

# Build a sandbox for one fixture. Prints the sandbox path + activation lines.
node scripts/skill-evals/make-sandbox.mjs --fixture feature-dirty-clean-payload

# ...or get the machine-readable manifest.
node scripts/skill-evals/make-sandbox.mjs --fixture feature-dirty-clean-payload --json

# Run the full safety checklist (see below).
node scripts/skill-evals/selfcheck.mjs

# Tear down one sandbox, or sweep all of them.
node scripts/skill-evals/teardown-sandbox.mjs <sandboxDir>
node scripts/skill-evals/teardown-sandbox.mjs --all
```

Sandboxes live under the OS temp dir by default (`skill-eval-sandboxes/`). Override with
`SKILL_EVAL_SANDBOX_ROOT` or `--root <dir>` — the harness **refuses** any location inside
the real repo.

To *enter* a sandbox, source the activation script `make-sandbox` prints. It prepends the
sandbox `bin/` to `PATH` (so the stub `gh` is the `gh` you get), unsets
`GH_TOKEN`/`GITHUB_TOKEN`, points `GH_CONFIG_DIR` inside the sandbox, and `cd`s you into the
repo.

## What a sandbox contains

```
<sandbox>/
  repo/                     # the working git repo — the executor's cwd
    .skill-eval-sandbox     # the marker: "no marker, no run" (gitignored inside repo)
    .git/  package.json  src/  docs/  ...
    .skill-eval-fake-test.mjs   # fake `npm test` (gitignored)
    .claude/skills/pr/.team-cache.json   # preseeded for warm/stale reviewer fixtures
  origin.git/               # local bare "origin" — push targets here, never real GitHub
  bin/                      # gh stub (gh, gh.ps1, gh.cmd, gh-stub.mjs) — prepended to PATH
  gh-config/                # isolated GH_CONFIG_DIR
  gh-fixture.json           # the data the stub answers from
  gh-calls.log              # every gh call, appended (primary grading evidence)
  env.json                  # the credential-scrub spec (unset / set / prependPath)
  activate.sh / activate.ps1  # source one to enter the sandbox
  manifest.json             # everything above, as paths
  .skill-eval-sandbox       # root marker (metadata; also used by teardown/audit)
```

## The `gh` stub (default-deny)

`gh-stub/gh-stub.mjs` answers only the surface the three team `SKILL.md` files actually use,
from `gh-fixture.json`, and **logs every call**. Any subcommand outside that surface
**hard-fails** (non-zero exit, logged) — it never passes through to the real `gh`. It also
refuses entirely if the sandbox marker is missing ("no marker, no run").

Stubbed surface (traced from `.claude/skills/{commit,pr,ship}/SKILL.md`):

| Subcommand | Used by | Notes |
|---|---|---|
| `auth status` | all three | success/failure from fixture `auth` |
| `issue view <N>` | commit, pr, ship | open issues from fixture `issues` |
| `pr view [N]` / `pr list` | pr, ship | branch-PR detection (both are pure reads) |
| `pr create` | pr | returns a PR URL; **per-call sequenced** for pr-7 (error→success) |
| `pr checks <N> [--watch]` | ship | exit 0 pass / 8 pending / 1 fail, from fixture `checks` |
| `pr merge <N> --merge --delete-branch` | ship | simulated; logged (never a real merge) |
| `pr comment <N> --body …` | pr | existing-PR comment |
| `run list` / `run watch <id>` | ship | post-merge run discovery/watch |
| `api user` / `api users/<login>` / `api repos/.../collaborators` | pr | reviewer team cache; emulates the `--jq` filters the skill uses |

This is a **superset** of spec II.2b's illustrative list — it adds `pr comment`, `run list`,
and `run watch` because pr-1 and ship-1/-3 genuinely call them. Everything genuinely
unexpected still hard-fails. To extend the surface for a new skill, add a handler in
`gh-stub.mjs` and the data it reads to the fixture — do not loosen the default-deny.

## Fixtures

Profiles live in [`lib/fixtures.mjs`](./lib/fixtures.mjs) as **plain data** (spec C13) — one
per `fixture` name referenced by a `kind: execution` eval. Each names the feature branch,
any commits/dirty working-tree changes, an optional preseeded reviewer cache, and the `gh`
data the stub answers from. Adding an eval is usually just adding a profile here; the harness
does not change. A build-time check rejects any profile with case-colliding filenames
(macOS's default filesystem is case-insensitive).

The set of profiles must cover **every** fixture name in the eval files. `selfcheck.mjs`
enforces this and fails loudly if a referenced name has no profile.

## Fake `npm test`

The sandbox `package.json`'s `test` script runs `.skill-eval-fake-test.mjs`, which passes
instantly. Red-path (spec II.2e): create a `.skill-eval-fail-test` sentinel in the repo to
force a failing gate — used by Phase 3's red-control demonstration.

## Safety checklist — `selfcheck.mjs`

`node scripts/skill-evals/selfcheck.mjs` runs the full Phase-2 safety checklist and exits
non-zero if anything fails:

- **fixture-completeness** — a profile exists for every referenced fixture name, and every
  profile builds.
- **default-deny** — an un-stubbed subcommand hard-fails, is logged, and does not pass
  through.
- **missing-marker** — the stub refuses with no marker; `make-sandbox` refuses a root inside
  the repo.
- **env-scrub** — `env.json` + both activate scripts unset the tokens and isolate
  `GH_CONFIG_DIR`; a live call proves creds are present before the scrub and absent after.
- **teardown** — a built sandbox removes cleanly.
- **call-log-liveness** — a stubbed call leaves positive evidence in `gh-calls.log`.
- **stub-answers / pr7-sequencing** — representative calls return the right output; pr-7's
  `pr create` returns error-then-success across two calls.
- **wrapper-on-path** — `gh` resolves to the stub via `PATH` on this OS.
- **zero-mutation-audit** — the real repo's HEAD, branches, and `git status` are unchanged
  by the run, and no sandbox branches leak in.

## Prompts (canonical operations)

- [`prompts/executor-prompt.md`](./prompts/executor-prompt.md) — the per-eval executor
  subagent template.
- [`prompts/batch-prompt.md`](./prompts/batch-prompt.md) — **the** full-suite regression
  operation (no lighter variant exists).
- [`prompts/platform-validation-prompt.md`](./prompts/platform-validation-prompt.md) — the
  macOS/other-OS smoke that runs one designated eval and auto-posts an artifact to a named
  issue.

## Notes for maintainers

- The stub `gh` is what a skill executor runs; the harness never invokes real `gh` (the one
  exception is the platform-validation prompt, which posts its artifact comment with real
  `gh` — a human-run action, not an eval execution).
- Run artifacts and sandboxes are never committed. Sandboxes live outside the repo; the
  in-sandbox marker, fake test, team cache, and skill control files are gitignored inside the
  sandbox repo, so a run leaves `git status` clean.
- The committed POSIX `gh` wrapper does not need the executable bit — `make-sandbox` sets
  `+x` on the sandbox copy at build time.
