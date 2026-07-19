# Platform validation prompt (macOS first)

A committed copy-paste prompt that validates the harness on a given platform: it runs the
harness self-check plus one designated eval end-to-end, emits a small pass/fail +
environment artifact, and **auto-posts the artifact to a named GitHub issue**. Retained
past baseline for re-validation whenever the harness shell wrappers or path handling change,
and for onboarding a teammate on a new OS.

- **Designated eval:** `commit-1` (fixture `feature-dirty-clean-payload`) — fast, exercises
  staging discipline + fake `npm test` + commit + push, no long waits, no complex gh
  sequencing.
- **Issue number:** fill `<ISSUE>` per run. For the baseline macOS smoke this is the
  **Phase-2 phase issue `#510`** (acceptance requires the artifact land there). Blocks
  *baseline completion*, never the Phase-2 PR.
- **The one real-`gh` touch:** posting the artifact comment uses the real `gh` against real
  GitHub. That is the sanctioned human-run action — it posts a validation comment, it does
  **not** execute an eval against the real repo. If `gh` is not authenticated, the prompt
  prints the artifact for the runner to paste by hand.

Copy the block below into a session on the target platform.

---

```
You are validating the skill-evals sandbox harness on THIS platform. Do the following and
post a short artifact. Everything eval-related runs inside a make-sandbox sandbox; the only
real-GitHub action is posting the final artifact comment.

ISSUE = <ISSUE>              # e.g. 510 for the Phase-2 macOS smoke
DESIGNATED_EVAL = commit-1   # fixture feature-dirty-clean-payload

1. Record the environment: OS + version, `node --version`, `git --version`, shell.

2. Run the harness self-check (builds every fixture, exercises the default-deny stub, the
   shell wrapper on PATH, env scrub, teardown, and the zero-mutation audit):
     node scripts/skill-evals/selfcheck.mjs
   Capture PASS/FAIL and the summary line.

3. Run the designated eval end-to-end:
     a. node scripts/skill-evals/make-sandbox.mjs --fixture feature-dirty-clean-payload --json
     b. Enter the sandbox (source the printed activate script) and CONFIRM the
        `.skill-eval-sandbox` marker exists — no marker, no run.
     c. Act as the assistant for the user turn: /commit "fix profile redirect", following
        .claude/skills/commit/SKILL.md. At the step-14 approval checkpoint, reply `y`
        (scripted human reply — valid only because the marker is present).
     d. Confirm from the gh call log + sandbox git state that: only explicit profile paths
        were staged (no `git add -A`/`git add .`), the fake `npm test` ran and passed,
        exactly one commit was made, and `git push -u origin <branch>` ran against the local
        bare origin.
     e. node scripts/skill-evals/teardown-sandbox.mjs <sandboxDir>

4. Build the artifact (markdown), e.g.:
     ## skill-evals platform validation
     - Platform: macOS 14.5 (arm64)
     - node: v24.x  | git: 2.4x  | shell: zsh
     - selfcheck: PASS (20/20)
     - designated eval commit-1: PASS (staging clean, npm test passed, 1 commit, pushed)
     - zero-mutation audit: clean (real repo untouched)

5. Post it: write the artifact to a temp file and run
     gh issue comment <ISSUE> --body-file <file>
   If `gh` is not authenticated, print the artifact verbatim for the runner to paste.

6. Sweep: node scripts/skill-evals/teardown-sandbox.mjs --all
```

---

**Retention:** revisit keep/slim/retire after the first macOS run (repo memory set,
decided 2026-07-19).
