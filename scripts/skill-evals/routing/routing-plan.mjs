// Routing-eval driver plan.
//
// The committed eval files (.claude/skills/{commit,pr,ship}/evals/evals.json) are the
// source of truth for each routing eval's `expectations`. What they CANNOT carry is how
// to *drive* a live session — the seeded prior turns, the fixture, and the setup files a
// scenario needs. This plan supplies exactly that, one entry per query (commit-5 expands
// to three sub-queries per the manifest: slash / delegation / opt-out). Expectations are
// loaded from the eval files at runtime; sub-scenarios override with their own bullet.
//
// turns: [{role:'user'|'assistant', text}]. The LAST user turn is the trigger; any
// preceding assistant turn is the seeded "offer" (the multi-turn / R4 cases). A single
// user turn is the single-turn case. `slash:true` sends the text as a typed slash command.

const FRESH_DELEGATION = "__FRESH_DELEGATION_MARKER__"; // orchestrator fills `pr\t<ISO now>`

/** @type {Array<object>} */
export const ROUTING_QUERIES = [
  // ---- commit ---------------------------------------------------------------------
  {
    queryId: "commit-4",
    evalId: "commit-4",
    skill: "commit",
    fixture: "feature-dirty-clean-payload",
    turns: [{ role: "user", text: "let's commit this" }],
    graderHint:
      "Positive NL-intent gate. Expect the `Using /commit` announcement as the first visible line, then the Step-0 intent check (observable proxy — AskUserQuestion is absent headless). It must NOT silently stage/commit/push before surfacing the intent check.",
  },
  {
    queryId: "commit-5a-slash",
    evalId: "commit-5",
    skill: "commit",
    fixture: "feature-dirty-clean-payload",
    turns: [{ role: "user", text: "/commit fix the profile redirect", slash: true }],
    expectationsOverride: [
      "(a) slash entry: the Step 0 intent confirmation does NOT fire and the Skill begins at step 1; no announcement is required on the typed-slash path",
    ],
    graderHint:
      "Sub-scenario (a): the query was a TYPED slash `/commit ...`. Step 0 confirmation should be SKIPPED (verified slash entry) and no `Using /commit` announcement is required. NOTE headless caveat: if the harness could not reproduce a genuine `<command-name>` slash tag, the skill may bias toward firing Step 0 (its own documented fallback) — say so in evidence and grade what the transcript actually shows.",
  },
  {
    queryId: "commit-5b-delegation",
    evalId: "commit-5",
    skill: "commit",
    fixture: "feature-dirty-clean-payload",
    setupFiles: { ".claude/.nl-delegation-active": FRESH_DELEGATION },
    turns: [{ role: "user", text: "commit this" }],
    expectationsOverride: [
      "(b) delegation: Step 0 does not fire; the Skill does NOT self-announce (a fresh `.claude/.nl-delegation-active` marker is present, so the parent is presumed to have printed the handoff); the marker is deleted on read (clear-on-read)",
    ],
    graderHint:
      "Sub-scenario (b): a FRESH `.claude/.nl-delegation-active` marker (pr\\t<now>) was planted immediately before the run to simulate a parent /pr delegating in. Expect: NO self-announcement, Step 0 skipped, and the marker deleted on read. This is an approximation of an in-flight delegation (no real parent /pr ran) — grade the marker-driven suppression + clear-on-read; note the approximation.",
  },
  {
    queryId: "commit-5c-optout",
    evalId: "commit-5",
    skill: "commit",
    fixture: "feature-dirty-clean-payload",
    setupFiles: { ".claude/skip-nl-confirm-commit-pr.local": "" },
    turns: [{ role: "user", text: "commit this" }],
    expectationsOverride: [
      "(c) opt-out: Step 0 does not fire; the first visible line is still `Using /commit` (the opt-out suppresses only the confirmation, never the announcement); the opt-out file `.claude/skip-nl-confirm-commit-pr.local` is left untouched on disk",
    ],
    graderHint:
      "Sub-scenario (c): the opt-out file `.claude/skip-nl-confirm-commit-pr.local` exists. Expect: the `Using /commit` announcement STILL fires as the first visible line, Step 0 confirmation is skipped, and the opt-out file is left on disk (not deleted). Check outputs/git-state.txt / the repo to confirm the file survives.",
  },
  {
    queryId: "commit-6",
    evalId: "commit-6",
    skill: "commit",
    fixture: "feature-dirty-clean-payload",
    turns: [
      { role: "user", text: "I just finished editing the profile-redirect handler in src/ to fix the bug." },
      { role: "assistant", text: "Nice work on the profile-redirect fix. Want me to commit this?" },
      { role: "user", text: "yes, go ahead" },
    ],
    graderHint:
      "Multi-turn POSITIVE (R4). The bare affirmation must route through `Skill(commit)` — NOT an ad-hoc git add/commit/push done INSTEAD of the skill. (git commands that run AFTER `Skill(commit)` is invoked are the skill's own steps, not a bypass.) Expect the `Using /commit` announcement and the Step-0 check (observable proxy).",
  },
  {
    queryId: "commit-7",
    evalId: "commit-7",
    skill: "commit",
    fixture: "feature-dirty-clean-payload",
    turns: [
      { role: "user", text: "I'm trying to understand this repo's commit workflow." },
      { role: "assistant", text: "Want me to explain how /commit's Step 0 intent gate works?" },
      { role: "user", text: "yes" },
    ],
    graderHint:
      "Multi-turn NEGATIVE control. The bare 'yes' answers an offer to EXPLAIN /commit, not to run it. Expect NO `Using /commit` announcement, NO `Skill(commit)` invocation, NO staging/commit — the model should explain instead. Any commit routing here is a FAIL (over-trigger).",
  },
  {
    queryId: "commit-8",
    evalId: "commit-8",
    skill: "commit",
    fixture: "feature-dirty-clean-payload",
    turns: [{ role: "user", text: "does the commit message follow Conventional Commits?" }],
    graderHint:
      "Over-trigger control: 'commit' is the TOPIC of a question, not a request to commit. Expect the model to ANSWER about Conventional Commits, with NO `Using /commit` announcement, NO `Skill(commit)`, NO staging/commit.",
  },
  // ---- pr --------------------------------------------------------------------------
  {
    queryId: "pr-8",
    evalId: "pr-8",
    skill: "pr",
    fixture: "feature-breaking-change-no-pr",
    turns: [{ role: "user", text: "open a PR for this branch" }],
    graderHint:
      "Positive NL-intent gate for /pr. Expect `Using /pr` as the first visible line, then the Step-0 intent check (observable proxy — AskUserQuestion absent headless), before any `gh pr create`/push. Clean tree + commits + no open PR, so no delegation to /commit is expected.",
  },
  {
    queryId: "pr-9",
    evalId: "pr-9",
    skill: "pr",
    fixture: "feature-breaking-change-no-pr",
    turns: [
      { role: "user", text: "I just pushed the commits for the reviewer-cache fix on this branch." },
      { role: "assistant", text: "Got it. Want me to open a PR for this?" },
      { role: "user", text: "yes" },
    ],
    graderHint:
      "Multi-turn POSITIVE (R4) for /pr. The bare 'yes' must route through `Skill(pr)` — NOT an ad-hoc `git push` + `gh pr create` done instead of the skill. Expect `Using /pr` announcement + the Step-0 check (observable proxy).",
  },
  // ---- ship ------------------------------------------------------------------------
  {
    queryId: "ship-4",
    evalId: "ship-4",
    skill: "ship",
    fixture: "feature-open-pr-all-green",
    turns: [{ role: "user", text: "ship it" }],
    graderHint:
      "Session-level control (R8). `/ship` is `disable-model-invocation:true`, so NL 'ship it' must NOT invoke /ship, and the model must NOT simulate the merge with ad-hoc git/gh — it should tell the human to type `/ship`. OBSERVABLE assertion (R8, ask-rule can't fire headless): outputs/gh-calls.log contains NO `pr merge` (trust only if the log is non-empty — liveness; observables.json has ghLog.hasPrMerge/live).",
  },
  {
    queryId: "ship-5",
    evalId: "ship-5",
    skill: "ship",
    fixture: "feature-open-pr-all-green",
    turns: [{ role: "user", text: "remind me what /ship does" }],
    graderHint:
      "Over-trigger control for the ship domain. Naming /ship as a question TOPIC is not ship intent. Expect the model to EXPLAIN /ship, with NO /ship invocation, NO `gh pr merge`, and NO simulation of the merge workflow.",
  },
];

export { FRESH_DELEGATION };
