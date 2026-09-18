---
name: handoff
description: "[is-app] Generate a session hand-off doc plus a copy-pasteable bootstrap prompt so a fresh Claude Code session (or a human teammate) can pick up in-flight work with zero prior context. Verifies current state via git/gh instead of trusting only what was said earlier in chat, and calls out any uncommitted changes. Supports three depths — compact (the default), full (complex, risky, or multi-workstream work), minimal (explicit request only) — selected via `--mode compact|full|minimal` or natural-language cues like \"quick minimal handoff\" or \"full handoff with the decisions and risks\". Use whenever the user is wrapping up a session and wants to continue later, is handing work to someone else, or says things like \"write a hand-off doc\", \"give me a bootstrap prompt for a fresh session\", \"prep this for tomorrow\", \"let's pick this up later\", `/handoff` — or is about to step away from a long multi-step task (mid-PR, mid-issue, blocked on review) with no next step written down anywhere."
---

# /handoff

A cold session can only work from what's written down. If a hand-off doc repeats a claim from
earlier in the conversation that's since gone stale — a PR that merged, a plan that changed — the
next session inherits the mistake and burns its first few turns rediscovering the truth. This
Skill's whole value is closing that gap: it re-derives state from `git`/`gh` rather than summarizing
memory, so the doc is right on the day someone actually reads it cold.

A hand-off must let the same agent, a fresh agent, or a human teammate resume safely without the
original conversation and without repeating completed investigation.

## Invocation

```text
/handoff [topic-slug] [--mode compact|full|minimal]
```

Examples: `/handoff notifier-retry --mode minimal` · `/handoff pr3-drift --mode full` ·
`/handoff --mode compact` · `/handoff pr3-drift`

**Topic slug** — optional; names the doc (`.scratch/<slug>-bootstrap.md`). If omitted, derive one
from the current branch name (strip a leading issue-number or type prefix, e.g.
`353-skill-nl-invocation` → `skill-nl-invocation`) or from the most recent issue/PR number
discussed in the conversation. If neither gives a reasonable slug, ask.

**Depth always travels via `--mode`, never as a bare word** — `/handoff compact` would be
indistinguishable from a topic slug named "compact", so don't treat bare depth words as modes.

**Natural language is an equal, first-class interface.** Fire on hand-off intent without requiring
the user to rephrase as a slash command: "write a handoff so I can pick this up tomorrow", "give
the next agent enough context to resume this work", "let's stop here and leave a handoff". Clear
depth modifiers in context are mode selections: "quick"/"minimal" → minimal; "compact" → compact;
"full"/"detailed"/"comprehensive" → full. The user's explicit wording always beats automatic
selection. If the wording is genuinely ambiguous *and* the choice materially affects how useful
the doc will be, ask one focused question; otherwise use the default and proceed.

Unlike `/commit` and `/pr`, this Skill only writes a gitignored scratch file and prints a message —
a local, reversible action — so it doesn't need their announce/confirm gate; just run it. Don't
bolt commit, PR, or merge confirmation gates onto writing the hand-off, and don't continue the
underlying implementation work unless the user separately asked for that.

## Choosing a depth (when the user didn't)

- **Compact** is the default for ordinary work.
- **Escalate to Full** when recovery risk is meaningful: multiple workstreams, consequential
  decisions, uncertain ownership, cross-agent or cross-team dependencies, complicated validation,
  a long execution history, significant unresolved state, or expensive rediscovery.
- **Never auto-select Minimal.** Compact already omits irrelevant fields and can be naturally
  short, so there's nothing for an automatic Minimal to save. Minimal exists only for an explicit
  request. If a requested Minimal would omit context needed for safe resumption, include that
  context concisely and mention the safety-driven expansion — don't silently switch modes.

### Selective section expansion

The selected mode is the document-level default, not a ban on essential context. A Compact doc may
borrow named Full fields for one section when omitting them would materially raise recovery risk —
e.g. stay Compact overall but expand Verified State to record uncertain change ownership or an
environment that matters. Keep it bounded:

- Add only fields the Full expansion table below already describes.
- Expand the smallest section that closes the recovery gap; don't cascade detail into unrelated
  sections.
- If an unspecified request needs Full-level treatment in multiple sections, select Full for the
  whole document instead.
- If the user explicitly asked for Compact or Minimal, keep that mode and add only the essential
  exception, concisely.

## Steps

1. **Determine the topic slug and depth** per the Invocation and depth rules above.

2. **Gather live state**, in parallel:
   - `git branch --show-current`
   - `git status --porcelain=v1`
   - `git log origin/main..HEAD --oneline` (commits not yet on `main`)
   - `gh pr view --json number,url,title,state,statusCheckRollup,reviewDecision` for the current
     branch, if a PR exists (ignore failure — it just means no PR yet)
   - `gh issue view <N> --json title,state,url` if an issue number is inferable from the branch
     name or conversation

3. **Reconcile with the conversation.** Where something was said earlier in this session (a PR
   status, a decision, a "done" claim), trust the verified command output over the recollection.
   When they conflict, say so explicitly in the doc — that correction is exactly what a fresh
   session most needs to see, since it has no way to notice the drift itself.

4. **Note uncommitted changes**, if any (`git status --porcelain` non-empty). This is
   informational, not a blocker — list the relevant files so the next session isn't surprised by
   stray local edits; don't require committing first, and don't claim ownership of changes the
   session didn't make. If a file's origin is unclear, record that uncertainty rather than
   guessing.

5. **Write the doc** to `.scratch/<slug>-bootstrap.md` using the Compact template below, adapted
   to the selected depth via the Full/Minimal transformation tables. Create `.scratch/` if it
   doesn't exist yet (already gitignored — see `.gitignore`). If a doc already exists at that
   path, this is an update, not a fresh start: move its still-useful prior state (the old Status /
   Verified State content) under a `## Historical` heading rather than deleting it, then write the
   new state above it. Treat the doc as a record that accumulates, the same instinct behind the
   append-only discipline used for multi-agent design-review docs in this repo — a hand-off doc
   that silently loses yesterday's state is less trustworthy, not more current.

6. **Print the bootstrap prompt** (template below) as the last thing in your response — this is
   what actually gets copy-pasted as the first message of the fresh session, so it belongs in the
   chat output, not buried only inside the file.

## What every depth must deliver

Depth changes how much explanation the doc carries, not what it's for. At any depth the doc:

- is self-contained Markdown that leads with the goal and current status;
- distinguishes completed work from remaining or optional work, verified facts from assumptions
  or unknowns, and new failures from pre-existing or unrelated ones;
- includes exact paths, commands, identifiers, links, commits, tests, and results whenever they
  reduce recovery work;
- tells the resuming agent to reverify mutable state, and includes one concrete, bounded next
  action;
- records blockers, unresolved questions, and approval gates that matter to subsequent work;
- says **how the work is done**, not just what state it is in: the orchestration pattern in use
  (solo, pair, hub-and-spoke), the agent roles or personas involved and what each owns, and the
  roles worth adding or swapping in next — plus the one question that keeps that list honest:
  *what gap did this effort hit that no role owned?* Required at every depth; for solo work,
  one line ("solo, no personas") is a complete answer;
- omits empty, redundant, irrelevant, or ceremonial sections — and never invents missing state.

## Compact template (canonical)

Compact is the canonical structure; Full and Minimal are transformations of it. This is a content
contract, not a mechanical form: remove fields that don't help resumption, keep the ones that do.

```markdown
# Hand-off: [topic/issue title]

**Updated:** [YYYY-MM-DD]

## Objective

**Goal:** [Desired outcome]

**Done when:**

- [Required result]
- [Required validation or deliverable]

**Out of scope:** [Important boundary]

## Status

- **Phase:** [Investigating / Implementing / Validating / Blocked / Ready for review]
- **Completed:** [Completed work and result]
- **Remaining:** [Required remaining work]
- **Blockers or questions:** [Only when relevant]

## Verified State

- **Workspace:** `[path or URL]`
- **Branch/commit:** `[branch and SHA]`
- **Working tree:** `[clean, or relevant modified/untracked files]`
- **Tracker:** `[primary issue, PR, project item, or "none"]`
- **Plan/spec:** `[governing plan, specification, design doc, or source of truth]`
- **Decision log:** `[roundtable, review log, ADRs, or "none"]`
- **Key files:** `[paths]`
- **Supporting references:** `[additional documents, artifacts, or links]`

Reverify mutable state before making changes.

## Decisions and Findings

- **Decision or finding:** [Conclusion]
  - **Why:** [Rationale]
  - **Evidence:** `[file, line, command, test, artifact, or link]`

**Unverified:** [Assumption or unknown, if relevant]

## Validation

- **Completed:** `[command or check]` → [result]
- **Still required:** [Check]
- **Pre-existing failure:** [Failure and evidence, if relevant]

## How this work is done

- **Pattern:** [solo / pair / hub-and-spoke — who verifies, who ships]
- **Roles in play:** [role — what it owns; one line each. "solo, no personas" is valid]
- **Roles to add or swap next:** [role — why; or "none identified"]
- **Gap no role owned this time:** [the answer, or "none hit"]

## Resume Here

1. Read `[source of truth]`.
2. Verify the recorded state.
3. Run `[fastest relevant check]`.
4. **Next action:** [One concrete, bounded action.]

**Approval required before:** [Commit, PR, merge, deploy, scope expansion, or other downstream gate]
```

When updating an existing doc, the `## Historical` section (per Step 5) sits at the bottom, below
Resume Here.

## How Full expands Compact

Full retains the relevant Compact content and adds detail only where omission would increase
delivery, technical, safety, ownership, or coordination risk.

| Compact area | Full expansion |
|---|---|
| Objective | Separate definition of done, deliverables, constraints, and non-goals. |
| Status | Separate completed, in-progress, not-started, deferred, and blocked work; identify the exact stopping point. |
| Verified State | Add base/baseline commit, change ownership, relevant recent changes, tracker status or relationships, environments, and artifact locations. |
| Work context | Add the approach taken, component or data flow, important boundaries, and partial implementation details. |
| Decisions | Use a concise decision log with rationale, alternatives, evidence, consequences, and final/provisional status. |
| Validation | Separate passed, failed, not-run, and manual checks; explain what each result proves. |
| Coordination | Add risks, dependencies, owners, open questions, and recovery notes when relevant. |
| How this work is done | Add the model policy in force, the rules learned from failures during this effort (each tied to the failure), and per-role attributes for any persona the next agent should define. |
| Resume plan | Add ordered preflight, subsequent steps, stop conditions, approval gates, and next-session completion criteria. |

Don't add Full-only sections for appearance. Include them when the scenario actually supplies
relevant content or their absence would raise recovery cost.

## How Minimal contracts Compact

Minimal preserves safe resumption while removing ceremony.

| Compact area | Minimal contraction |
|---|---|
| Objective | Combine the goal and completion condition into one or two lines. |
| Status | Short Done, Remaining, and Blocker/Unknown bullets. |
| Verified State | Preserve the essential workspace, tracker, plan/spec, decision-log, key-file, branch/commit, and relevant working-tree anchors, presented concisely; omit deeper history, ownership, relationships, and environment detail unless needed for safe resumption. |
| Decisions | Only a decision, assumption, or correction that directly affects the next action. |
| Validation | The last meaningful result and the next required check. |
| How this work is done | One line: the pattern, and either the roles or "solo, no personas". Never omit the section. |
| Resume plan | One verification step, one exact next action, and any real downstream approval gate. |
| Omitted material | Decision tables, risk registers, detailed chronology, alternatives, multi-step plans. |

If Minimal needs many exceptions to stay safe, keep the requested mode and state the essential
extra context concisely.

## Bootstrap prompt template

Printed in chat, not written to the file:

```text
You're picking up in-flight work on <topic> (<tracker ref>) in the intentional-society/is-app repo.
Read `.scratch/<slug>-bootstrap.md` first — it has verified current state, gotchas, and the next
step. <One-sentence orientation: what stage this is at, e.g. "design is done, you're implementing"
or "PR is up, waiting on review feedback.">
```

## Failure modes

- **`gh` unavailable or unauthenticated.** Degrade to git-only state; note in the doc that PR/issue
  status wasn't verified and should be rechecked.
- **No `.scratch/` yet.** Create it — already gitignored (see `.gitignore`).
- **No prior context to summarize** (nothing done yet this session, clean tree, nothing
  distinguishing in flight). Ask what topic or branch the hand-off is for rather than fabricating
  a doc about nonexistent work.
- **A doc already exists at the target path.** Update it — preserve still-useful prior state under
  `## Historical` rather than overwriting it.
- **Verified state contradicts something said earlier in the conversation.** Trust the verified
  output and call out the correction explicitly — that's the exact gap this Skill exists to close.
- **Ambiguous depth wording.** Only ask if the choice materially changes the doc's usefulness;
  otherwise default to Compact (escalating to Full per the depth rules) and move on.

## Depends on

- `CLAUDE.md`
- `.gitignore` (the `.scratch/` convention)
- `gh` CLI (optional — degrades gracefully without it)

## TODO (maintainers) — as of 2026-09-18

- The "How this work is done" section (working pattern, personas, the gap no role owned)
  has never been exercised: the three assertions covering it in `evals/evals.json` have
  not been run.
- `evals/evals.json` is pre-harness (bespoke shape). Migrate it to the sandbox harness per
  `docs/strategy-skill-evals.md` §7 (~10 fixture profiles in
  `scripts/skill-evals/lib/fixtures.mjs`), then decide whether `handoff` joins the `SKILLS`
  list in `tests/functional/skills/skill-contract.test.ts`. Never execute these evals
  outside a harness sandbox.
- Tracker: #507, Parked list.
