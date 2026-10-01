# Archived routing run (test fixture)

`eval-commit-4-with_skill-run-1/` is one routing run of `commit-4` from the 2026-09-24 full pass,
graded after the #583 void rule landed. It was scrubbed by #618 before check-in: home-folder paths
read `<home>`, session ids read `<uuid>`, and usage figures are emptied. The file layout is the
runner's own (`input.jsonl`, `raw.jsonl`, `transcript.md`, `grading.json`, `grader-envelope.json`,
`timing.json`, `outputs/` and the rest).

Recorded verdict: 3 of 3 expectations PASS; `grader-envelope.json` has `num_turns: 10`.

Who uses it:

- `tests/functional/skills/regrade-cli.test.ts`, the unit tests for
  `scripts/skill-evals/routing/regrade.mjs` (with a fake grader, so no model is called);
- the hand run of the re-grade CLI described in `docs/strategy-skill-evals.md` §6 step 5.

Never edit these files. The tests hash every file in the fixture when the test file starts and
again when it ends, and once more before and after one full run, and fail if anything changed. Biome skips this folder (`biome.json`, `files.includes`).
