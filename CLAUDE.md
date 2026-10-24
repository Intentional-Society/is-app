# CLAUDE.md

Claude Code instructions for this repository. The project guidance shared by all AI coding agents lives in `AGENTS.md`, imported here:

@AGENTS.md

## AI Skills

Three Claude Code Skills live at `.claude/skills/` and encode the team's check-in workflow. `/commit` and `/pr` are invocable by slash command **or** natural language ("commit this", "open a PR") — **this includes the case where *you* offered to commit or open a PR and the human merely affirms ("yes", "go ahead", "do it"): that affirmation is the trigger.** (Only an affirmation of *your own commit/PR offer* counts — a "yes" to an unrelated offer like a refactor, rename, or search is **not** a trigger; don't fire the Skill on it.) Route every commit/PR intent through the Skill via the `Skill` tool; never hand-roll the commit or PR with ad-hoc `git`/`gh`. On **every** natural-language (model-invoked) run, **announce `Using /commit` or `Using /pr` as you route — the first line of the message in which you call the `Skill` tool, before the call** — so the human can see which Skill fired (an ad-hoc commit can't honestly print it; announcing at the routing decision, not waiting until inside the Skill, is what makes it reliable). **When a Skill delegates (`/ship` → `/pr` → `/commit`), the parent announces the handoff** (`Using /commit — delegated from /pr`); the delegated child does not re-announce. On the natural-language path the Skills also confirm intent first (Step 0) unless `.claude/skip-nl-confirm-commit-pr.local` exists (the confirmation offers a "don't ask again" option that creates that per-machine opt-out file); the announcement still fires even when that confirmation is skipped. `/ship` is explicit-only (`disable-model-invocation: true`): on ship/merge intent, ask the human to type `/ship` — never run or simulate the merge workflow yourself.

- `/commit [issue-or-context]` — stage, run `npm test`, draft a Conventional Commit-style message, bundled human approval, push. See [.claude/skills/commit/SKILL.md](.claude/skills/commit/SKILL.md).
- `/pr [PR#|URL|issue-or-context]` — fetch + rebase if main moved, push, open or update the PR. Does not watch CI. See [.claude/skills/pr/SKILL.md](.claude/skills/pr/SKILL.md).
- `/ship [PR#|URL|issue-or-context]` — orchestrates `/pr` (which orchestrates `/commit`), waits for CI green, merges via `gh pr merge --merge --delete-branch`, watches `main` for 5 minutes post-merge. See [.claude/skills/ship/SKILL.md](.claude/skills/ship/SKILL.md).

Design and rationale: [docs/spec-portable-ai-procedures.md](docs/spec-portable-ai-procedures.md); natural-language-invocation design: [docs/plan-skill-nl-invocation.md](docs/plan-skill-nl-invocation.md).

A fourth skill, Anthropic's upstream `skill-creator` (used to build and eval the Skills above; model-invokable like `/commit` and `/pr` — only `/ship` is explicit-only), is vendored verbatim at `.claude/skills/skill-creator/`, pinned to an upstream commit. Check/refresh via `node scripts/update-skill-creator.mjs --check`. See [docs/doc-skill-creator.md](docs/doc-skill-creator.md).

**Skill evals.** Skill-eval prompts (`.claude/skills/{commit,pr,ship}/evals/evals.json`) are never executed against the real repo or real GitHub — any skill, any origin. Execution happens only inside a harness-built sandbox (`scripts/skill-evals/`, via `make-sandbox --fixture <name>`); see [docs/strategy-skill-evals.md](docs/strategy-skill-evals.md) for the safety model and the run workflow. New to skill evals? Start with the one-page [quick start](docs/strategy-skill-evals-quick-start.md).
