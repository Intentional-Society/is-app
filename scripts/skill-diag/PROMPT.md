# Skill-diagnostic prompt (qualitative read)

Paste everything in the fenced block below into a **Claude Code session opened in this repo**
(`intentional-society/is-app`). It complements `skill_diag.py`: the script gives deterministic
counts across four dimensions (adoption, autonomy-vs-break-out, friction/outcomes, environment)
plus raw skill-discovery signals; this prompt reads a sample of your transcripts to add the
*why* and to turn the discovery signals into concrete candidate-skill proposals.

**Privacy:** to do the qualitative read, Claude will read your own local transcripts, which
contain your prompts and code. The **report it writes must not** — it may quote only short,
paraphrased phrases and only when they illustrate a point. You review and redact before you
share it. Nothing is sent anywhere automatically.

---

```
You are analyzing my usage of this repo's Claude Code Skills (/commit, /pr, /ship) from my local
transcripts. Produce a short, shareable report with NO sensitive content (no raw prompts, code,
diffs, file contents, commit messages, paths, or URLs — paraphrase instead).

STEP 1 — Quantitative baseline.
If scripts/skill-diag/skill_diag.py exists, run:
    python scripts/skill-diag/skill_diag.py --since 30d
and read the skill-diag-*.json it writes into scripts/skill-diag/out/. Use its numbers as ground
truth; your job is to explain and extend them, not recompute them.

STEP 2 — Read a sample of my transcripts for THIS repo at
~/.claude/projects/<sanitized repo path>/*.jsonl  (folder = this repo's absolute path with every
non-alphanumeric char replaced by "-"). Skim the most recent ~15 sessions with skill activity
(find them via the `attributionSkill` field). Also skim ~10 recent sessions REGARDLESS of skill
use (for STEP 4).

STEP 3 — Diagnose across the four dimensions. For each, give the number from STEP 1 plus the
context the number can't show:
  A. ADOPTION — how often I reach for each skill, slash vs natural-language, and the week-over-week
     trend. Am I leaning on them more or less over time? Any skill I've stopped using?
  B. AUTONOMY vs BREAK-OUT — how much the agent completes on its own vs stops to make me approve
     something. Call out the /ship MERGE confirmation specifically (the harness `ask` rule on
     `gh pr merge` prompts me even though I typed /ship explicitly — the thing that annoyed me):
     how often, and did I treat it as redundant? Also the Step 0 NL intent gate, the /pr reviewer
     picker, the suspicious-file blocker, and any tool prompts I declined.
  C. FRICTION & OUTCOMES — the 1–3 approvals that most cost me time, and whether runs actually
     COMPLETED (reached a commit / PR / merge) or stalled/were abandoned. Look for me typing
     things like "why is it asking again", "just do it", "stop asking", or re-running a skill.
     Note any failures (npm test, gh auth, refusals) that interrupted a run.
  D. ENVIRONMENT — do I run in `default` mode (more prompts) or `acceptEdits`/`auto`? Am I on an
     old Claude Code version? Would a mode/version change remove prompts I found pointless?

STEP 4 — Skill-discovery: what ELSE could be a skill?
Read the skill_diag.py JSON `skill_discovery` block (top_command_signatures, recurring_sequences,
tool_mix, existing_skills) AND the sessions from STEP 2. Identify recurring workflows/task-types
I do by hand that are NOT already covered by an existing skill. Look for:
  - Repeated multi-step command sequences (e.g. a fixed run of gh/git/npm commands I redo often).
  - Repeated KINDS of requests I make (e.g. "reset the local DB and reseed", "triage failing e2e",
    "bump a dependency and update docs") — cluster by intent, not exact wording.
  - Toil the agent repeats across sessions.
Propose 3–5 candidate skills. For each: a one-line trigger/description, a rough step outline
(3–6 steps), why it's worth automating (frequency + friction), and confirm it doesn't duplicate
an existing skill in `.claude/skills/`. Skip anything already covered by /commit, /pr, /ship.

STEP 5 — Write scripts/skill-diag/out/skill-diag-qualitative.md with sections:
  - Summary (2–3 sentences)
  - The four dimensions (A–D above), each 2–4 bullets with numbers + context
  - Top friction & cheapest fixes (incl. the .claude/skip-nl-confirm-commit-pr.local opt-out and
    `/ship` in `auto` mode where relevant)
  - Candidate new skills (from STEP 4)
  - Open questions for Blake
Keep it under ~600 words. Then show it to me and ask me to review/redact before I share it.
Do not send it anywhere.
```

---

After Claude writes `scripts/skill-diag/out/skill-diag-qualitative.md`, read it, trim anything you're not comfortable
sharing, and send it (plus `skill-diag-*.md` from the script) to Blake.
