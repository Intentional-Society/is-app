# skill-diag — usage diagnostics for the /commit, /pr, /ship Skills

The Skills carry **no runtime telemetry**. The only record of how they're actually used is each
person's **local Claude Code transcripts** (`~/.claude/projects/<sanitized-repo-path>/*.jsonl`).
This folder holds two tools that read those transcripts *on your own machine* and summarize Skill
usage and friction, so we can find and fix the parts that slow people down.

## What it measures — four dimensions + discovery

1. **Adoption** — invocations per skill, slash vs natural-language entry, and a week-over-week
   trend (are the skills being leaned on more or less over time).
2. **Autonomy vs break-out** — for each skill, actions the agent took on its own vs times it
   stopped for a human approval, broken down by kind (merge confirmation, Step 0 gate, reviewer
   picker, declines). This is the "how much does it interrupt me" number.
3. **Friction & outcomes** — the specific approvals that recur (the `/ship` merge confirmation,
   the Step 0 NL gate), plus completion signals (`git commit`s, merges) so you can see whether
   runs finish or stall.
4. **Environment** — permission-mode split (`default` prompts more than `auto`/`acceptEdits`),
   Claude Code versions, API errors.

Plus **skill-discovery**: recurring command shapes and sequences across sessions — candidate
workflows that aren't skills yet. The script surfaces the mechanical signals; `PROMPT.md` turns
them into concrete candidate-skill proposals.

## For the person running it (e.g. James)

Two complementary reads — run one or both, then share the output if you're comfortable.

**1. Deterministic counts (no LLM):**

```bash
python scripts/skill-diag/skill_diag.py            # this repo, all sessions
python scripts/skill-diag/skill_diag.py --since 30d
```

Writes `skill-diag-<date>.md` and `.json` into **`scripts/skill-diag/out/`** (created on demand,
resolved relative to the script so it works from any working directory). Emits only aggregates —
counts, dates, Skill names, Claude Code versions, permission modes, and the fixed intent-gate
answers. It **never** emits your prompts, replies, code, diffs, file paths, or commit messages.
Branch names are omitted unless you pass `--include-branches`. Useful flags: `--since 30d|48h|2w`,
`--scan-all`, `--stdout` (print only, write nothing), `--top N`, `--out <basename>`.
Requires Python 3.9+, standard library only.

**2. Qualitative read (Claude explains the *why*):** open [PROMPT.md](PROMPT.md) and paste the
fenced prompt into a Claude Code session in this repo. Claude reads a sample of your transcripts
and writes `skill-diag-qualitative.md`. It sees your content in order to summarize it, but the
report is written to exclude sensitive text — **review and redact it before sharing.**

## What we're looking for

The headline metric is **autonomy vs break-out**: for each skill, how many actions the agent took
on its own vs how many times it stopped to make you approve something. Two suspects:

- **The `/ship` merge confirmation.** The checked-in `ask` rule on `gh pr merge` prompts to
  approve the merge *even when you typed `/ship` explicitly* — by design, since the merge is the
  one irreversible act. Running `/ship` in `auto` mode auto-approves it (at the cost of that
  gate); it is intentionally un-weakenable in `default` mode. The report counts these as "merge
  confirmations."
- **The Step 0 natural-language intent gate** (the "Run /commit with…? Proceed / Proceed and don't
  ask again / Stop" prompt before a natural-language commit/PR). Per-machine opt-out: choose
  **"Proceed and don't ask again"** once, or create `.claude/skip-nl-confirm-commit-pr.local` —
  suppresses *only* that Step 0 confirm; the real payload approval still runs.

The diagnostic shows which of these (or the reviewer picker, suspicious-file blocker, or plain
`default`-mode permission prompts) is actually costing time.

## Privacy summary

| Tool | Reads | Emits |
|---|---|---|
| `skill_diag.py` | your local transcripts | aggregate counts only — no transcript text |
| `PROMPT.md` (Claude) | your local transcripts | a summary you review/redact before sharing |

Everything is written locally. Nothing leaves your machine unless you send it.
