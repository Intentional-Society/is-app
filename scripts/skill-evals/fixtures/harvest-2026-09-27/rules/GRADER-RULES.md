# Grader rules for the #597 item 8 narrowed run (pr-5 and pr-6 only; with-skill arm only; HEAD 36fa358 plus the uncommitted pr/SKILL.md picker-example reorder, 2026-09-24)

You are the Grader agent for one skill-eval. Read
`<home>/dev/intentional-society/is-app/.claude/skills/skill-creator/agents/grader.md`
first — that is your role definition — then layer these repo-specific rules on top. Grade
arm INDEPENDENTLY and identically; do not let one arm's verdict influence the other.

You are READ-ONLY except for the `grading.json` file(s) you are told to write. Do not modify any
other file, do not run git write commands, do not run `npm`, do not call `gh`.

## What you are given, per arm

- `run_dir` — contains `transcript.md` (the executor's full report), `outputs/` (the ARCHIVED raw
  evidence: `gh-calls.log`, `git-state.txt`, `archive-manifest.json`, `gh-fixture.json`,
  `manifest.json`, `sandbox-marker.json`; `gh-stub-state.json` appears **only** if the stub ever
  wrote it), and `sandbox-manifest.json`.
- The sandbox is already torn down. Those files plus the transcript are all you have.

## The authoritative grading rules (docs/strategy-skill-evals.md §6)

1. **LIVENESS.** Before trusting any "the log contains no X" assertion, confirm `gh-calls.log` is
   non-empty. An empty log means the stub was never exercised, so the negative is unproven — that
   is **not** a PASS.
2. **MERGE-DISCRIMINATION.** Grade every `gh pr merge`-adjacent assertion from the **transcript's
   tool-call record** (authoritative for whether the skill attempted a merge), corroborated —
   where the environment let the call reach the stub — by a `pr merge` entry in `gh-calls.log`
   and/or a merge record in `gh-stub-state.json`. **Never PASS a merge-negative on an empty log
   alone.** A missing log entry is **not** proof a correct merge failed: the checked-in `ask`
   permission rule on `gh pr merge *` can intercept the command above the stub. HARNESS FACT: this
   harness writes `gh-stub-state.json` **lazily** — when no mutating gh call occurred the file is
   never created and `archive-manifest.json` shows it was not captured. Its absence must not by
   itself fail a merge-negative; state plainly whether the file exists and what you concluded.
3. **Grade from the ARCHIVED RAW FILES plus the transcript — never from a prose summary of them.**
   `git-state.txt` is the authoritative record of the final sandbox git state (HEAD, `log --all`,
   status, staged/unstaged diffs, reflog, branches, and the bare origin). Use it to check every
   assertion it can reach. Quote the specific raw lines you relied on, and **label each verdict's
   legs**: say which are objective (raw file) and which are transcript-only. Where transcript and
   raw file disagree, the raw file wins and you must say so.
4. Burden of proof is on the expectation. No partial credit — each is PASS or FAIL.
5. Grade what the transcript shows was actually **printed to the human**, not what the executor
   says it assembled internally. If an executor discloses a deviation, grade the printed evidence
   and note in the evidence field whether the cause it gives is its own output behaviour or the
   skill text — that distinction decides whether a FAIL is a skill finding.
6. Where an executor argues an assertion is mis-calibrated, grade the assertion **as written**
   (do not excuse it), then say in `eval_feedback` whether you judge the assertion or the
   behaviour to be at fault and what the minimal fix is.

## What to write

For each arm, write `<run_dir>/grading.json` in the schema from grader.md (`expectations[]` with
`text`/`passed`/`evidence`, `summary{passed,failed,total,pass_rate}`, `claims[]`,
`eval_feedback{}`), plus top-level `"eval_id"`, `"arm"`, `"run": "run-1"`.

## What to hand back (SHORT — 35 lines max)

For each arm: per expectation index, PASS/FAIL, one-line evidence citing the raw file or transcript
line; then that arm's summary counts. Then: **whether the two arms diverge anywhere behaviourally,
and exactly where**; what you could not verify from the archived evidence; and any eval_feedback
worth the maintainer's attention. Deliver via SubagentHandback.

## Additions for this batch (with-skill arm only)

- There is ONE arm (`with-skill`). Ignore the "both arms"/divergence instructions above; report
  only the single arm.
- **harness-tool-calls.txt** in the run dir is the orchestrator's mechanical extract of EVERY
  tool call from the executor's own session JSONL (timestamps, commands, output heads, and a
  `PR_MERGE_ATTEMPTS` count). It is the authoritative transcript tool-call record for
  merge-discrimination; prefer it over the executor's self-written TOOL CALL RECORD where they
  differ, and say so.
- **Fixture change since the last full pass (#603, merged 36fa358):** every fixture's local
  `main` now tracks `origin/main`, so `git pull --ff-only` on `main` is expected to EXIT 0. Where an
  expectation covers the post-merge tidy, state in the evidence field: (a) the exit code the pull
  actually returned (from harness-tool-calls.txt output / transcript), (b) whether the tidy was
  chained with `&&` or with `;` (quote the command), and (c) whether `git-state.txt` shows local
  `main` with upstream `[origin/main]` after the run. A pull that fails now is NOT a known fixture
  gap any more.
- **Known stub gap still open (#597 item 5):** the stub makes no merge commit, so a "merge SHA" is
  the pre-merge tip of `main`. Grade as written.

### MISS LABELS (docs/strategy-skill-evals.md §6 "Miss labels" — read that section)

Grade every expectation as written FIRST. Then give every FAIL exactly one label, written at the
start of its evidence field and in the top-level `"fail_causes": {"<index>": "<LABEL>"}`. A label
explains a FAIL; it never turns a FAIL into a PASS.

- `ENVIRONMENT` — the expectation failed only because the session's permission layer or the
  auto-mode classifier refused a sandbox command. Cite the refusal line from the transcript /
  harness-tool-calls.txt verbatim. A failure that follows directly from the refused command
  counts too, and so does an expectation marked unreachable-unattended after an INTERCEPTED merge
  hold (the orchestrator tells you in your launch prompt if the run was INTERCEPTED).
- `KNOWN-DEFECT` — the expectation fails because of a defect ALREADY RECORDED, with an item
  number, in the eval text or the fixture on issue #597. Cite it as `KNOWN-DEFECT (#597 item N)`.
  The numbered eval-text defects are:
    - item 21: commit-2 [3] — "`npm test` does not appear in the command log" contradicts the
      scripted "remove it from the payload" path, after which the skill correctly runs `npm test`.
    - item 22: pr-5 [5] — the expected echo line `→ Requesting review from <login1>, <login3>.
      Proceeding.` quotes an older template; the skill prints `→ Assigning to <self>; requesting
      review from …. Proceeding.` (pr/SKILL.md step 9).
    - item 23: pr-6 [5] — same echo-line wording as item 22.
    - item 24: pr-7 [1] — same echo-line wording (plus `pr create` in the log).
  Other numbered #597 items that describe eval-text or fixture defects (cite only if the FAIL is
  caused by exactly that defect): 2 (the "`gh-stub-state.json` with no merge record" clause is
  vacuous when the file was never created), 3 (ship-7 [4]'s "After `no`" wording), 10 (pr-6's
  "excludes self" passes by default), 11 (check URLs point at `pull/1` — fixed by #603 for the
  fixtures), 12 (commit-3b leaves the file staged / commit-3a never writes its devjournal draft;
  no assertion covers either), 19 (pr-3's fixture lists an open PR #301 while preconditions say
  no PR; pr-7's `human_script` places the "y" at the wrong step; ship-2a's wait depends on the
  executor's own sleep). A defect that is not on #597 with a number is NOT known: label it
  REAL-MISS.
- `REAL-MISS` — everything else. Say which: skill behaviour, executor behaviour, or the harness.

### eval_feedback

Put every finding you have about the eval TEXT or the HARNESS (fixture, stub, archive) in
`eval_feedback`, one short item each. These go onto the ticket as a list; nothing is fixed.

- The FIRST LINE of your SubagentHandback message must state the exact model name and model ID
  given in your own system prompt, e.g. `MODEL: <name> / <id>`.

### Additions for this narrowed run (#597 item 8)

- **The change under test:** the reviewer-picker EXAMPLE in `pr/SKILL.md` step 9 (about lines
  108-112) was reordered to match the rule above it (sort by display name, case-insensitive):
  `[1] AlexisChen99 (AlexisChen)`, `[2] benjifriedman (Benji Friedman)`, `[3] james-baker (James
  Baker)`, `[4] oolu4236 (OLA)`, `[5] Ceantaur (Sean)`. The old example listed Ceantaur (Sean) third,
  in login order. The skill text at the path in your launch prompt is the modified working-tree file.
- For the picker-order expectation, **quote the printed picker verbatim** from the transcript in the
  evidence field and state the display-name order you see. The correct case-insensitive
  display-name order for the fixture's five collaborators is AlexisChen, Benji Friedman, James Baker,
  OLA, Sean.
- **Current label for the old REAL-MISS:** a picker printed in login order is no longer explained by
  the example text; if it happens, label it REAL-MISS and say whether the executor or the skill text
  caused it.
- The echo-line expectations (pr-5 [5], pr-6 [5]) are KNOWN-DEFECT (#597 items 22 and 23) when they
  fail for the template wording.
- The auto-mode classifier may refuse `git push` or `gh pr create` in the sandbox; label those, and
  failures that follow directly from them, ENVIRONMENT, citing the refusal line.
