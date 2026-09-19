# Outline — `docs/strategy-skill-evals.md` (for Blake's sign-off)

**Drafted:** 2026-07-19 03:33 -07:00 (Fable). **Status:** APPROVED by Blake 2026-07-19 —
Phase 1 builds `docs/strategy-skill-evals.md` from this outline (spec III.2, Phase 1),
at which point this file retires. The doc is born in Phase 1 and grows through Phase 5;
sections marked *(P2)*/*(P4)*/*(P5)* land with those phases.

**Audiences:** humans and agents equally — plain-English sections short enough to load
into any session; copy-paste prompts for humans to hand to agents.

## Proposed structure

1. **What this doc is** — the repo-specific overlay on the vendored `/skill-creator`;
   one paragraph; pointer to the spec for why/design. The one rule up front: *skill-eval
   prompts are never executed against the real repo — any skill, any origin; execution
   happens only in harness sandboxes.* Note for program implementers: how a fresh-session
   agent picks up a phase is NOT this doc's job — that's the delegation protocol in spec
   III.1 + the parent issue's kickoff template; this doc is what those agents consult
   while working.
2. **Lifecycle map** *(the I.6-01 addition)* — create → test → maintain, one row per
   step: the front door to invoke (`/skill-creator`, slash or natural language), what
   stock does, what our overlay adds at that step (safety-triage question, schema,
   sandbox, platform routing), and where to look next. Includes the new-skill
   **safety-triage question** ("does this skill mutate git/GitHub?") as a documented
   step, not just a diagram line.
3. **Eval schema reference** — upstream fields + our additive fields (`kind`, `fixture`,
   `human_script`, `expectations`; retained `preconditions` prose = human contract,
   fixture = executable truth); allowed `kind` values; the `$comment` execution notice;
   what the contract test enforces and its prescriptive failure messages.
4. **The safety model** — trust boundary, "no marker, no run" invariant, `human_script`
   scoping rule, structural protections (local bare origin, stubbed `gh` on PATH), the
   backstop stack; honest limits (C8).
5. **Layer A reality check** *(the II.1-01 addition)* — expected `quick_validate.py`
   results on this repo's skills, including the `/ship` `disable-model-invocation`
   rejection (C7): what the failure means, why it is NOT a defect, and why
   `skill-contract.test.ts` is the real gate. Written so an agent mid-authoring-flow
   doesn't misread the known failure.
6. **Running evals — the one testing rule** — when the full batch is required (any team
   skill change or vendored refresh); THE batch prompt (copy-paste #1); ship-2 scheduled
   in the first parallel wave; PR-template checkbox semantics; runs are human-triggered,
   never CI.
7. **Reusable patterns for your own skill** *(the I.4-02 addition — Blake's /handoff
   pain point)* — written for a future author, human or agent, building ANY skill whose
   evals need git/GitHub state: how to reuse `make-sandbox` + fixture profiles + the
   logging `gh` stub outside the three team skills; worked example: *"your skill's evals
   need a mock repo with open PRs and commits to check against — here's the fixture
   profile to copy and the three lines to adapt."* Adding a new fixture profile
   (data-only, no harness code) as a worked example. Where the team boundary sits
   (committed = governed; local-only = supported, not governed).
8. **Platform routing (Layer C)** *(P4)* — the plain-English why (C2 Windows crash);
   per-platform table; the Layer-C runner prompt (copy-paste #2).
9. **Platform validation prompt** *(P2)* — copy-paste #3; issue-number placeholder;
   auto-posts artifact via `gh issue comment` (fallback: print for manual paste);
   trigger conditions (baseline once; harness wrapper/path changes; new-OS onboarding);
   note: retention revisited after first run (repo memory).
10. **Real-repo exception lane** *(P5)* — the human-run e2e smoke runbook: recorded
    justification, steps, cleanup owed (C12).
11. **Maintenance rules** — edit skills in place (never delete-and-recreate); vendored
    dir is stock (refresh via drift workflow); workspaces are gitignored artifacts;
    where decisions live (spec IV.1) and where state lives (parent issue).

**Open question for Blake at sign-off:** none blocking — the only judgment call is how
much of section 7 lands in Phase 1 vs. grows in Phase 2 when the harness exists; proposal:
skeleton + schema-level patterns in Phase 1, executable worked example in Phase 2.
