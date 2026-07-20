# Executor-subagent prompt template (one execution eval, one sandbox)

This is the canonical prompt for the executor subagent that runs a single
`kind: execution` eval inside a harness-built sandbox. The batch operation
(`./batch-prompt.md`) fans this out across every execution eval; Phase 3 consumes it
verbatim. Copy the block below and fill the `{{…}}` placeholders from the eval object and
the `make-sandbox` manifest.

> **Safety contract (non-negotiable).** This prompt is only ever run against a
> harness-built sandbox. The executor's very first action is to confirm the
> `.skill-eval-sandbox` marker exists in its working directory — **no marker, no run.** It
> then confirms the sandbox `gh` stub — not the real GitHub CLI — is the one on PATH, by
> checking that `gh auth status` prints the `(SANDBOX gh stub)` marker — **stub not on
> PATH, no run.** The scripted human replies below are valid **only** because the marker is
> present; in the real repo every approval always comes from a live human.

---

```
You are an execution-eval executor for the {{SKILL}} skill. You are operating INSIDE a
disposable skill-eval sandbox — a throwaway git repo with a fake `gh` and a fake `npm
test`. Nothing you do here can reach the real repo or real GitHub.

STEP 0 — MARKER GATE (do this first, before anything else):
  Confirm the file `.skill-eval-sandbox` exists in your current working directory. If it
  does NOT exist, STOP immediately and report "no marker — refusing to run". Do not run any
  git or gh command. (You should already be in the sandbox repo: {{SANDBOX_REPO}}. If your
  shell is not activated, run the activation line the harness printed:
    PowerShell:  . {{ACTIVATE_PS1}}
    Git Bash/macOS/Linux:  source {{ACTIVATE_SH}}
  Activation puts the stub `gh` on PATH, unsets GH_TOKEN/GITHUB_TOKEN, isolates
  GH_CONFIG_DIR, and cd's you into the sandbox repo.)

  STUB-LIVENESS GATE (still STEP 0 — do this right after the marker check and activation,
  before any git/gh command or eval action): run `gh auth status` and confirm its output
  contains the exact string "(SANDBOX gh stub)". If that string is ABSENT, the real GitHub
  CLI — not the sandbox stub — won the PATH race: STOP immediately, report "stub not on
  PATH — refusing to run", and run no further git or gh command. (The stub prints this
  marker in its `gh auth status` output; the real gh never does. The stub writes it to
  stderr, so inspect stderr, not just stdout. This turns an activation/PATH misroute into a
  hard stop before any eval action: credential scrubbing still blocks a real-GitHub reach,
  but a misrouted real `gh` produces no stub call-log entry, so the grader's evidence would
  silently go dark — this gate refuses to run rather than grade against a dark log.)

CONTEXT YOU MAY RELY ON:
  - The sandbox starting state is the fixture `{{FIXTURE}}`. Its preconditions:
    {{PRECONDITIONS}}
  - `gh` in this sandbox is a logging stub. It answers a fixed surface from fixture data
    and hard-fails any un-stubbed subcommand. Every call is logged.
  - `npm test` is a fake that passes instantly (unless a red-path sentinel is present).

YOUR TASK:
  Act as the assistant in a session where the user's turn is exactly:
    {{EVAL_PROMPT}}
  Follow the {{SKILL}} skill (.claude/skills/{{SKILL}}/SKILL.md) faithfully, step by step,
  exactly as you would in a real session — including its approval checkpoints.

SCRIPTED HUMAN REPLIES (valid only because the marker is present):
  {{HUMAN_SCRIPT}}
  When the skill reaches an approval/prompt point, respond with the scripted reply above
  for that point, then continue. Do not invent additional human input.

DO NOT:
  - Run any command outside this sandbox, or `cd` out of it.
  - Attempt to reach real GitHub or the real repo.
  - Work around a hard-failing gh call — if the stub denies a subcommand, that is signal,
    not an obstacle to route around. Report it.

WHEN DONE, REPORT:
  1. A transcript of what you did (the assistant turns).
  2. The final sandbox git state: `git log --oneline -5`, `git status --short`,
     `git branch -vv`.
  3. Confirm the gh call log path for the grader: {{GH_CALL_LOG}}
  4. Your own read on each expectation below (the grader is authoritative; this is a hint):
     {{EXPECTATIONS}}
```

---

## Filling the placeholders

| Placeholder | Source |
|---|---|
| `{{SKILL}}` | `skill_name` from the eval file (`commit` / `pr` / `ship`) |
| `{{EVAL_PROMPT}}` | the eval's `prompt` |
| `{{FIXTURE}}` | the eval's `fixture` |
| `{{PRECONDITIONS}}` | the eval's `preconditions` |
| `{{HUMAN_SCRIPT}}` | the eval's `human_script` (verbatim) |
| `{{EXPECTATIONS}}` | the eval's `expectations` list |
| `{{SANDBOX_REPO}}`, `{{ACTIVATE_PS1}}`, `{{ACTIVATE_SH}}`, `{{GH_CALL_LOG}}` | fields of the `make-sandbox --json` manifest (`repoDir`, `activate.ps1`, `activate.sh`, `ghCallLog`) |

## Baseline arm

For a skill **update**, the baseline arm runs the same prompt against a sandbox built the
same way but with the *old* snapshot of the skill on the path (native skill-creator
convention). For a **new** skill, the baseline is "no skill". Build a second sandbox with
`make-sandbox --fixture <name>` and point the baseline executor at the old `SKILL.md`.

## Grading

Do not grade inside the executor. The grader (vendored `agents/grader.md`) reads the three
evidence sources — the transcript, the gh call log (`ghCallLog`), and the sandbox git
state — against the eval's `expectations`, and applies the **liveness rule**: before
trusting any "log contains no X" assertion, confirm the call log is non-empty (positive
proof the stub was exercised and PATH was wired correctly).
