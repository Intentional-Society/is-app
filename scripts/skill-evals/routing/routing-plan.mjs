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
      "(a) Typed-slash is CLI-native — NO `Skill(commit)` tool call is expected. A literal `/commit …` typed by a human is expanded by the Claude Code CLI's own slash-command parser, which injects the skill body directly into context; it does NOT route through the `Skill` tool (docs/plan-skill-nl-invocation.md 'Shared mechanism facts' #1; SKILL.md Step 0, whose intent gate fires ONLY when the skill was invoked via the `Skill` tool). The absence of any `Skill()` invocation (`invokedThisSkill:false`) is therefore CORRECT and EXPECTED on this path — it must NOT be graded as a failure, and it does NOT make any assertion below 'vacuous' or 'ungradeable'. Grade every assertion below on the transcript's text and its non-Skill tool calls.",
      "No Step-0 INTENT-DETECTION confirmation fires: before touching git, the model does NOT surface a 'Run /commit with: <detected context>?' intent check (no `AskUserQuestion`, no textual equivalent). This is DISTINCT from the step-14 CONTENT-approval checkpoint ('Proceed with this commit? (Y/n)', shown at the END alongside the drafted message + staged payload) — that gate always runs and IS expected here; do not mistake it for a Step-0 firing.",
      "The model proceeds directly into the /commit workflow's documented steps from step 1 — inspecting `git status`/`git diff`, staging the deliberate payload, running `npm test`, drafting the commit message — i.e. it executes the skill's STEPS inline. ('Begins at step 1' means the skill's steps run inline; it does NOT mean a `Skill()` tool call is observed.)",
      "No `Using /commit` announcement is required on the typed-slash path: its absence is NOT a failure (and its presence, if any, is also acceptable and not scored).",
    ],
    graderHint:
      "Sub-scenario (a): a TYPED slash `/commit fix the profile redirect`. SETTLED ARCHITECTURE (load-bearing — docs/plan-skill-nl-invocation.md 'Shared mechanism facts' #1 and PR1/PR2 acceptance checklist item 6; plus SKILL.md Step 0, whose intent gate fires ONLY when the skill was invoked via the `Skill` tool): an explicit typed slash is expanded by the Claude Code CLI's parser and injected DIRECTLY, so it NEVER routes through the `Skill` tool. No `Skill(commit)` call is expected and `invokedThisSkill:false` is the CORRECT result. Contrast commit-4 — the genuine NL case — which DOES require a `Skill()` call + `Using /commit` + Step 0. Therefore: do NOT fail this run, and do NOT declare any assertion 'vacuous'/'impossible to grade', merely because the Skill tool was never invoked — that non-invocation IS the expected slash-native behavior. PASS = the transcript shows NO pre-work Step-0 intent confirmation (again: the final 'Proceed with this commit? (Y/n)' content-approval at step 14 is a DIFFERENT, expected gate) AND the model runs the commit workflow's steps inline (git status/diff, npm test, message draft). The announcement is not required either way. HARNESS LIMITATION — THIS IS A REAL GRADING BRANCH, NOT JUST CONTEXT: the runner feeds this query as literal text on stdin and cannot inject a kernel-level `<command-name>` slash tag. SKILL.md Step 0 explicitly instructs that when that signal 'isn't reliably visible, bias toward FIRING the gate' — so a Step-0 confirmation appearing here is the skill following its own documented fallback under a condition the harness manufactured, and it must NOT be scored as a failure. If Step 0 fires, say so in evidence, attribute it to the missing slash tag, and still PASS the run provided the model otherwise executes the commit workflow inline. Only fail this assertion if the model does something Step 0's fallback does not explain. (Removing this branch is what moved #528's flakiness from the model onto the grader — do not remove it again without re-reading SKILL.md Step 0.)",
  },
  {
    queryId: "commit-5b-delegation",
    evalId: "commit-5",
    skill: "commit",
    fixture: "feature-dirty-clean-payload",
    setupFiles: { ".claude/.nl-delegation-active": FRESH_DELEGATION },
    // R4-shaped seed, mirroring commit-6/pr-9 — but unlike those, the assistant's seeded
    // turn is not a QUESTION being answered; it's the parent's already-printed delegation
    // announcement being CONTINUED. Turn 1 deliberately reuses commit-6's own opener
    // (regression-verified 3/3, zero trigger risk for either skill) instead of a
    // self-standing commit-trigger phrase like "commit this" — a real /pr->/commit
    // delegation never begins with the human typing that, and seeding it created a second,
    // competing routing signal (see #527 SDET review). The human's only turns here are a
    // neutral statement and a bare continuation; the ENTIRE delegation signal comes from
    // the seeded assistant turn + the fresh marker on disk, so the eval isolates
    // announcement-suppression from the routing decision itself.
    turns: [
      { role: "user", text: "I just finished editing the profile-redirect handler in src/ to fix the bug." },
      { role: "assistant", text: "Using /commit — delegated from /pr" },
      { role: "user", text: "go ahead" },
    ],
    // TWO LIMITS THIS EVAL CANNOT CLOSE HEADLESS — both root-caused in the #527 SDET review, so
    // do not re-diagnose them:
    //
    // 1. CLEAR-ON-READ IS UNGRADEABLE HERE, so it is deliberately NOT asserted below. Deleting
    //    anything inside `.claude/` is refused by built-in Claude Code protection — reproduced in
    //    a bare scratch dir with no fixture and no settings; the same filename in another
    //    directory deletes fine. Headless has no prompter, so the refusal is absolute. It works
    //    in the real repo only because an interactive session can approve the prompt. Sandbox
    //    `permissions.allow` cannot lift it either (untrusted workspaces ignore those entries).
    //    Marker deletion is covered by the manual runbook instead — docs/strategy-skill-evals.md §6.
    //
    // 2. THE 30s MARKER LEASE CAN EXPIRE MID-RUN, so expect ~2/3 rather than 3/3. setupFiles are
    //    written before the executor starts, and the model generates through all three seeded
    //    turns before Step 0 ever reads the marker — measured at 47s and 67s old. Step 0 then
    //    correctly treats it as stale and fires. That is right behavior meeting a harness timing
    //    limit, not a defect; closing it means restructuring when setup files are applied
    //    relative to turn processing.
    expectationsOverride: [
      "(b) delegation: Step 0's intent confirmation does NOT fire — a fresh `.claude/.nl-delegation-active` marker is present, so the parent is presumed to have printed the handoff already.",
      "(b) delegation: the Skill does NOT self-announce — the model's NEW response to 'go ahead' must not re-print `Using /commit`, because the seeded assistant turn already shows the parent printing it.",
    ],
    graderHint:
      "Sub-scenario (b): a FRESH `.claude/.nl-delegation-active` marker (pr\\t<now>) was planted immediately before the run, AND the seeded conversation already shows the parent's handoff line `Using /commit — delegated from /pr` as the assistant's PRIOR turn. The human's own turns (a neutral statement, then a bare 'go ahead') deliberately do NOT repeat 'commit' or otherwise self-trigger — the routing/announcement signal comes entirely from the seeded assistant turn + the marker, not from the human's wording (mirrors commit-6's precondition that the affirmation 'does NOT repeat the word commit'). Expect: the model's NEW generated response (to 'go ahead') does NOT re-print the `Using /commit` announcement, and Step 0's intent confirmation is skipped. DO NOT grade marker deletion (clear-on-read): deleting inside `.claude/` is blocked by built-in Claude Code protection and cannot succeed headless, so it is not asserted — a failed or refused deletion is NOT a failure of this eval, and its absence must not be cited against any assertion. STALENESS BRANCH: if the transcript shows the model read the marker and judged it STALE (>30s old — setup runs before the executor, so multi-turn generation can push it past the lease), then Step 0 firing and a self-announcement are the CORRECT documented responses to a stale marker. Record that as evidence and grade the run as an environment-limited miss, not a skill defect. This remains an approximation of an in-flight delegation (no real parent /pr ran, and seeded assistant turns carry no backing tool_use) — note the approximation.",
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
