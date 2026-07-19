#!/usr/bin/env python3
"""
skill_diag.py — deterministic diagnostic for the /commit, /pr, /ship Claude Code Skills.

WHY THIS EXISTS
    The Skills carry no runtime telemetry — there is no usage log, no phone-home.
    The only record of how you actually use them is your LOCAL Claude Code session
    transcripts (~/.claude/projects/<sanitized-repo-path>/*.jsonl). This script reads
    those transcripts on YOUR machine and emits an aggregate summary across four
    dimensions — (1) adoption (invocations, slash vs NL, week-over-week trend),
    (2) autonomy vs break-out (autonomous actions vs human-approval prompts, incl. the
    `gh pr merge` confirmation and the "Step 0" intent gate), (3) friction & outcomes
    (which approvals recur; whether runs reach a commit/merge), and (4) environment
    (permission mode, Claude Code version). It also mines recurring command shapes and
    sequences to suggest workflows that could become NEW skills (skill-discovery).

PRIVACY — what this collects and what it never touches
    Emitted:  counts, timestamps/date ranges, Skill names, Claude Code versions,
              permission modes, and the fixed gate answers ("Proceed" / "Stop" /
              "Proceed and don't ask again").
    NEVER emitted: your prompts, the assistant's replies, code, diffs, file paths,
              commit messages, or any free-text transcript content. Branch names are
              omitted unless you pass --include-branches.
    Reports are written to scripts/skill-diag/out/ (created on demand) so they never
    land loose in the repo. Nothing is sent anywhere. Read the output, then share it
    (or not) at your discretion.

USAGE
    python scripts/skill-diag/skill_diag.py                # this repo, all sessions
    python scripts/skill-diag/skill_diag.py --since 30d    # only the last 30 days
    python scripts/skill-diag/skill_diag.py --scan-all     # every project, filtered to this repo's cwd
    python scripts/skill-diag/skill_diag.py --stdout       # print the report, write nothing

Pure standard library. Python 3.9+.
"""

from __future__ import annotations

import argparse
import glob
import json
import os
import re
import sys
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path

# The three team Skills this diagnostic is about. Others are reported but not the focus.
TEAM_SKILLS = ("commit", "pr", "ship")
# Fingerprint of the Step 0 natural-language intent gate: it is the only AskUserQuestion
# in these Skills that offers a "…don't ask again" option (creates the opt-out file).
GATE_OPTION_MARKER = "don't ask again"
OPTOUT_REL = os.path.join(".claude", "skip-nl-confirm-commit-pr.local")
CMDNAME_RE = re.compile(r"<command-name>\s*/?([a-z0-9][a-z0-9-]*)", re.IGNORECASE)
# tool_result answer string looks like:  ..."="Stop". You can now continue...
GATE_ANSWER_RE = re.compile(r'"\s*=\s*"([^"]+)"')
# Exact string a tool_result carries when a human denies a permission prompt.
DECLINE_MARKER = "the user doesn't want to proceed with this tool use"
# The one merge form (ship/SKILL.md step 11); the checked-in `ask` rule prompts on each.
MERGE_RE = re.compile(r"\bgh\s+pr\s+merge\b")


# --- workflow mining (skill-discovery) -------------------------------------------------
# Trivial commands that say nothing about a workflow — excluded from discovery.
NOISE_SIGS = {"", "cd", "echo", "ls", "pwd", "cat", "clear", "true", "false", "sleep",
              "export", "set", "which", "type", "head", "tail", "wc", "sort", "uniq"}
# Characters that mark an argument/path/value/redirect — the signature stops before them,
# so no file paths, URLs, or literal values ever land in the output.
SIG_STOP = set("/\\=\"$'`{}()<>*")


def command_signature(cmd: str) -> str:
    """Privacy-safe command shape: executable + up to 2 sub-tokens, no args/paths/values.

    'gh pr merge 483 --delete-branch' -> 'gh pr merge';  'npm run test:functional' stays whole;
    'git commit -m "…"' -> 'git commit'. Anything with a path/redirect/quote stops the signature.
    """
    cmd = re.split(r"[|&;\n]", cmd.strip(), maxsplit=1)[0].strip()
    out: list[str] = []
    for tok in cmd.split():
        if tok.startswith("-") or any(c in tok for c in SIG_STOP):
            break
        out.append(tok)
        if len(out) >= 3:
            break
    return " ".join(out)


def iso_week(ts: datetime | None) -> str | None:
    return ts.strftime("%G-W%V") if ts else None


def classify_auq(question: str, options: list) -> str:
    """Fingerprint an AskUserQuestion into the Skill checkpoint it represents."""
    labels = " ".join((o.get("label", "") or "").lower() for o in options)
    q = (question or "").lower()
    if "don't ask again" in labels:
        return "nl_intent_gate"           # /commit,/pr Step 0
    if "wait+5" in labels or "troubleshoot" in labels:
        return "ci_wait"                  # /ship CI / post-merge supervised handoff
    if "reviewer" in q or "reviewers" in q or "login" in q:
        return "reviewer_picker"          # /pr Step 9
    return "other"


def sanitize_project_name(path: str) -> str:
    """Reproduce Claude Code's project-dir naming: non-alphanumerics -> '-'."""
    return re.sub(r"[^a-zA-Z0-9]", "-", os.path.abspath(path))


def claude_projects_root() -> Path:
    return Path(os.path.expanduser("~")) / ".claude" / "projects"


def parse_since(spec: str | None) -> datetime | None:
    if not spec:
        return None
    m = re.fullmatch(r"(\d+)\s*([dhw])", spec.strip().lower())
    if not m:
        raise SystemExit(f"--since: expected e.g. '30d', '48h', '2w', got {spec!r}")
    n, unit = int(m.group(1)), m.group(2)
    delta = {"h": timedelta(hours=n), "d": timedelta(days=n), "w": timedelta(weeks=n)}[unit]
    return datetime.now(timezone.utc) - delta


def parse_ts(raw: str | None) -> datetime | None:
    if not raw:
        return None
    try:
        return datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        return None


def iter_records(path: Path):
    """Yield every parsed JSON record from one transcript, in file order."""
    with path.open(encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                yield json.loads(line)
            except json.JSONDecodeError:
                continue


def content_blocks(rec: dict):
    msg = rec.get("message") or {}
    content = msg.get("content")
    if isinstance(content, str):
        return [{"type": "text", "text": content}]
    if isinstance(content, list):
        return [b for b in content if isinstance(b, dict)]
    return []


class Accumulator:
    def __init__(self, since: datetime | None):
        self.since = since
        self.sessions = 0
        self.sessions_with_activity = 0
        self.first_ts: datetime | None = None
        self.last_ts: datetime | None = None
        self.versions: Counter = Counter()
        self.permission_modes: Counter = Counter()
        self.branches: set[str] = set()
        # entry paths
        self.slash_entries: Counter = Counter()   # from <command-name>
        self.nl_entries: Counter = Counter()       # from Skill tool_use
        # work volume (attributionSkill message counts — how much each skill actually did)
        self.attributed_msgs: Counter = Counter()
        # --- autonomy vs break-out (the core "how much does it ask me" measure) ---
        # autonomous tool calls the agent made itself (tool_use, excluding AskUserQuestion),
        # keyed by the skill the emitting message is attributed to.
        self.autonomous_tool_calls: Counter = Counter()
        # human-facing prompts the agent stopped for, categorized:
        self.auq_by_skill: dict[str, Counter] = defaultdict(Counter)   # attr -> category -> n
        self.merge_confirmations: Counter = Counter()                  # attr -> n (gh pr merge)
        self.declined_tool_uses: Counter = Counter()                   # attr -> n (human said no)
        # permission mode split, per skill (default => prompts; auto => auto-approves)
        self.permmode_by_skill: dict[str, Counter] = defaultdict(Counter)
        # Step 0 gate answers (Proceed / Stop / …don't ask again)
        self.gate_by_skill: Counter = Counter()
        self.gate_answers: Counter = Counter()
        # --- context: adoption over time + outcomes reached ---
        self.week_invocations: dict[str, Counter] = defaultdict(Counter)  # ISO week -> skill -> n
        self.git_commits: Counter = Counter()      # attr -> `git commit` calls (/commit outcome)
        self.pr_links = 0                          # pr-link records (a /pr outcome)
        self.merge_calls_total = 0                 # `gh pr merge` calls (/ship outcome attempt)
        # --- skill-discovery: recurring workflows that aren't skills yet ---
        self.cmd_sigs: Counter = Counter()                       # signature -> total count
        self.cmd_sig_sessions: dict[str, set] = defaultdict(set)  # signature -> {session ids}
        self.cmd_bigrams: Counter = Counter()                    # "sigA → sigB" -> count
        self.tool_mix: Counter = Counter()                       # tool name -> count
        # error signals
        self.api_errors = 0

    def _bump_ts(self, ts: datetime | None):
        if ts is None:
            return
        if self.first_ts is None or ts < self.first_ts:
            self.first_ts = ts
        if self.last_ts is None or ts > self.last_ts:
            self.last_ts = ts

    def add_session(self, path: Path):
        self.sessions += 1
        active = False
        session_id = path.stem
        # Per-session maps so tool_results (which carry no attributionSkill) can be
        # traced back to the skill that emitted the originating tool_use.
        gate_toolids: dict[str, str] = {}      # tool_use_id -> skill (for the NL-gate answer)
        tooluse_attr: dict[str, str] = {}      # tool_use_id -> attributionSkill (for declines)
        prev_sig: str | None = None            # for command bigrams within this session
        for rec in iter_records(path):
            ts = parse_ts(rec.get("timestamp"))
            if self.since and ts and ts < self.since:
                continue
            rtype = rec.get("type")
            if rtype == "pr-link":              # a /pr outcome (PR opened or updated)
                self.pr_links += 1
                continue
            if rtype not in ("user", "assistant"):
                continue
            role = rtype  # "user" | "assistant"
            attr = rec.get("attributionSkill")

            if rec.get("version"):
                self.versions[rec["version"]] += 1
            if rec.get("permissionMode"):
                self.permission_modes[rec["permissionMode"]] += 1
                if attr:
                    self.permmode_by_skill[attr][rec["permissionMode"]] += 1
            if rec.get("gitBranch"):
                self.branches.add(rec["gitBranch"])
            if rec.get("isApiErrorMessage"):
                self.api_errors += 1

            if attr:
                self.attributed_msgs[attr] += 1
                self._bump_ts(ts)

            for b in content_blocks(rec):
                btype = b.get("type")
                if btype == "text":
                    # Slash entry = a <command-name> tag, only in a *user* turn (the
                    # harness injects it when a slash command is typed). Assistant text
                    # can echo the tag, so ignore assistant-role occurrences.
                    if role == "user":
                        for m in CMDNAME_RE.finditer(b.get("text", "")):
                            name = m.group(1).lower()
                            if name in ("commit", "pr", "ship", "skill-creator", "run"):
                                self.slash_entries[name] += 1
                                if name in TEAM_SKILLS:
                                    self.week_invocations[iso_week(ts) or "?"][name] += 1
                                active = True
                                self._bump_ts(ts)
                elif btype == "tool_use":
                    name = b.get("name")
                    tid = b.get("id", "")
                    if attr:
                        tooluse_attr[tid] = attr
                    self.tool_mix[name or "?"] += 1
                    if name == "Skill":
                        skill = (b.get("input") or {}).get("skill", "?")
                        self.nl_entries[skill] += 1
                        if skill in TEAM_SKILLS:
                            self.week_invocations[iso_week(ts) or "?"][skill] += 1
                        active = True
                        self._bump_ts(ts)
                    elif name == "AskUserQuestion":
                        for q in (b.get("input") or {}).get("questions", []):
                            cat = classify_auq(q.get("question", ""), q.get("options", []))
                            self.auq_by_skill[attr or "(unattributed)"][cat] += 1
                            if cat == "nl_intent_gate":
                                gate_toolids[tid] = attr or "(unattributed)"
                        active = True
                    else:
                        # An autonomous action the agent took without stopping to ask.
                        if attr:
                            self.autonomous_tool_calls[attr] += 1
                        cmd = (b.get("input") or {}).get("command", "") if isinstance(b.get("input"), dict) else ""
                        if name in ("Bash", "PowerShell") and cmd:
                            # outcome markers
                            if MERGE_RE.search(cmd):
                                self.merge_confirmations[attr or "(unattributed)"] += 1
                                self.merge_calls_total += 1
                                active = True
                            if re.search(r"\bgit\s+commit\b", cmd):
                                self.git_commits[attr or "(unattributed)"] += 1
                            # workflow mining: privacy-safe command signature + session breadth
                            sig = command_signature(cmd)
                            if sig and sig not in NOISE_SIGS:
                                self.cmd_sigs[sig] += 1
                                self.cmd_sig_sessions[sig].add(session_id)
                                if prev_sig and prev_sig != sig:
                                    self.cmd_bigrams[f"{prev_sig} → {sig}"] += 1
                                prev_sig = sig
                elif btype == "tool_result":
                    tid = b.get("tool_use_id")
                    content = b.get("content")
                    text = content if isinstance(content, str) else json.dumps(content)
                    low = (text or "").lower()
                    if DECLINE_MARKER in low:
                        self.declined_tool_uses[tooluse_attr.get(tid, "(unattributed)")] += 1
                        active = True
                    if tid in gate_toolids:
                        self.gate_by_skill[gate_toolids[tid]] += 1
                        m = GATE_ANSWER_RE.search(text or "")
                        answer = m.group(1) if m else "unknown"
                        low_a = answer.lower()
                        if "don't ask again" in low_a:
                            answer = "Proceed and don't ask again"
                        elif low_a.startswith("proceed"):
                            answer = "Proceed"
                        elif low_a.startswith("stop"):
                            answer = "Stop"
                        self.gate_answers[answer] += 1
                        active = True
        if active:
            self.sessions_with_activity += 1


def collect_files(project_dir: Path | None, scan_all: bool) -> list[Path]:
    root = claude_projects_root()
    if scan_all:
        return sorted(root.glob("*/*.jsonl"))
    if project_dir is None:
        project_dir = root / sanitize_project_name(os.getcwd())
    files = sorted(project_dir.glob("*.jsonl"))
    if not files:
        # graceful fallback: scan everything, filter by cwd match happens in caller if needed
        alt = sorted(root.glob("*/*.jsonl"))
        if alt:
            print(f"note: no transcripts under {project_dir}; falling back to --scan-all", file=sys.stderr)
            return alt
    return files


def _autonomy_for(acc: Accumulator, skill: str) -> dict:
    """Decompose one skill into work the agent did itself vs times it stopped to ask.

    prompts_shown = structured decision prompts (AskUserQuestion) + merge confirmations.
    autonomous_actions = other tool calls (the merge command is netted out so it isn't
    double-counted as both a prompt and autonomous work).
    autonomy_ratio = share of "action points" the agent handled without stopping.
    """
    auq = dict(acc.auq_by_skill.get(skill, {}))
    auq_total = sum(auq.values())
    merges = acc.merge_confirmations.get(skill, 0)
    declined = acc.declined_tool_uses.get(skill, 0)
    autonomous = max(acc.autonomous_tool_calls.get(skill, 0) - merges, 0)
    prompts = auq_total + merges
    denom = autonomous + prompts
    return {
        "autonomous_tool_calls": autonomous,
        "prompts_shown": prompts,
        "prompts_breakdown": {"askuserquestion": auq, "merge_confirmations": merges},
        "declined_by_human": declined,
        "autonomy_ratio": round(autonomous / denom, 3) if denom else None,
        "permission_mode": dict(acc.permmode_by_skill.get(skill, {})),
    }


def existing_skill_names(repo_root: Path) -> list[str]:
    """Skills already defined in the repo, so discovery can exclude what's covered."""
    skills_dir = repo_root / ".claude" / "skills"
    if not skills_dir.is_dir():
        return []
    return sorted(p.name for p in skills_dir.iterdir()
                  if p.is_dir() and (p / "SKILL.md").exists())


def build_report(acc: Accumulator, repo_root: Path, include_branches: bool, top_n: int = 20) -> dict:
    optout = (repo_root / OPTOUT_REL).exists()
    nl_team = sum(acc.nl_entries[s] for s in TEAM_SKILLS)
    gate_total = sum(acc.gate_by_skill.values())
    top_sigs = [
        {"signature": s, "count": c, "sessions": len(acc.cmd_sig_sessions.get(s, ()))}
        for s, c in acc.cmd_sigs.most_common(top_n)
    ]
    report = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "repo_root": str(repo_root),
        "window": {
            "sessions_scanned": acc.sessions,
            "sessions_with_skill_activity": acc.sessions_with_activity,
            "first_activity": acc.first_ts.isoformat() if acc.first_ts else None,
            "last_activity": acc.last_ts.isoformat() if acc.last_ts else None,
        },
        "invocations_per_skill": {
            s: {
                "slash": acc.slash_entries.get(s, 0),
                "natural_language": acc.nl_entries.get(s, 0),
                "total": acc.slash_entries.get(s, 0) + acc.nl_entries.get(s, 0),
            }
            for s in TEAM_SKILLS
        },
        "work_volume_messages": {s: acc.attributed_msgs.get(s, 0) for s in TEAM_SKILLS},
        "autonomy": {
            s: _autonomy_for(acc, s) for s in TEAM_SKILLS
        },
        "merge_confirmations_total": sum(acc.merge_confirmations.values()),
        "adoption_over_time": {
            wk: dict(acc.week_invocations[wk]) for wk in sorted(acc.week_invocations)
        },
        "outcomes_reached": {
            "commit_git_commits": sum(acc.git_commits.values()),
            "ship_merge_calls": acc.merge_calls_total,
            "pr_link_references": acc.pr_links,  # every pr-link record (PR surfaced), not opens
        },
        "skill_discovery": {
            "note": "Recurring command shapes and sequences in this person's sessions — candidate "
                    "workflows for new skills. Signatures are executable+subcommand only (no args, "
                    "paths, or values). 'sessions' = how many distinct sessions the shape appears "
                    "in; broad + frequent = stronger candidate. The prompt does the semantic pass.",
            "existing_skills": existing_skill_names(repo_root),
            "top_command_signatures": top_sigs,
            "recurring_sequences": [
                {"sequence": seq, "count": c}
                for seq, c in acc.cmd_bigrams.most_common(top_n) if c >= 2
            ],
            "tool_mix": dict(acc.tool_mix.most_common()),
        },
        "step0_nl_gate": {
            "fired_total": gate_total,
            "by_skill": dict(acc.gate_by_skill),
            "answers": dict(acc.gate_answers),
            "natural_language_runs": nl_team,
            "fired_per_nl_run": round(gate_total / nl_team, 2) if nl_team else None,
            "optout_file_present": optout,
        },
        "permission_modes": dict(acc.permission_modes),
        "claude_code_versions": dict(acc.versions.most_common()),
        "api_error_messages": acc.api_errors,
        "other_skills_seen": {
            k: v for k, v in acc.attributed_msgs.items() if k not in TEAM_SKILLS
        },
    }
    if include_branches:
        report["branches"] = sorted(acc.branches)
    return report


def render_markdown(r: dict) -> str:
    w = r["window"]
    g = r["step0_nl_gate"]
    lines = []
    lines.append("# Skill diagnostic — /commit /pr /ship")
    lines.append("")
    lines.append(f"- Generated: `{r['generated_at']}`")
    lines.append(f"- Sessions scanned: **{w['sessions_scanned']}** "
                 f"(with skill activity: **{w['sessions_with_skill_activity']}**)")
    if w["first_activity"]:
        lines.append(f"- Activity window: `{w['first_activity']}` → `{w['last_activity']}`")
    lines.append("")
    lines.append("## Invocations per skill")
    lines.append("")
    lines.append("| Skill | Slash | Natural language | Total | Msgs of work |")
    lines.append("|---|--:|--:|--:|--:|")
    for s in TEAM_SKILLS:
        iv = r["invocations_per_skill"][s]
        lines.append(f"| /{s} | {iv['slash']} | {iv['natural_language']} | "
                     f"{iv['total']} | {r['work_volume_messages'][s]} |")
    lines.append("")
    lines.append("_Invocations = direct entries you made. `/ship` delegates to `/pr` and `/pr` "
                 "to `/commit` internally; those delegated sub-runs are not counted as separate "
                 "invocations but do show up in “Msgs of work”._")
    lines.append("")
    aot = r["adoption_over_time"]
    if aot:
        lines.append("### Adoption over time (invocations per ISO week)")
        lines.append("")
        lines.append("| Week | " + " | ".join(f"/{s}" for s in TEAM_SKILLS) + " |")
        lines.append("|---|" + "|".join(["--:"] * len(TEAM_SKILLS)) + "|")
        for wk in list(aot)[-8:]:  # last 8 active weeks
            row = aot[wk]
            lines.append(f"| {wk} | " + " | ".join(str(row.get(s, 0)) for s in TEAM_SKILLS) + " |")
        lines.append("")
    oc = r["outcomes_reached"]
    lines.append(f"- **Outcomes reached:** {oc['commit_git_commits']} `git commit`s · "
                 f"{oc['ship_merge_calls']} merges — completion signals; compare against "
                 "invocations above to gauge how often a run finishes vs stalls. "
                 f"({oc['pr_link_references']} PR-link references seen — PRs surfaced, not opens.)")
    lines.append("")
    lines.append("## Autonomy vs break-out  ← how much the agent did itself vs stopped to ask")
    lines.append("")
    lines.append("| Skill | Autonomy | Autonomous actions | Prompts shown | of which merge confirms | Declined by you |")
    lines.append("|---|--:|--:|--:|--:|--:|")
    for s in TEAM_SKILLS:
        a = r["autonomy"][s]
        ratio = "—" if a["autonomy_ratio"] is None else f"{a['autonomy_ratio']*100:.0f}%"
        lines.append(f"| /{s} | {ratio} | {a['autonomous_tool_calls']} | {a['prompts_shown']} | "
                     f"{a['prompts_breakdown']['merge_confirmations']} | {a['declined_by_human']} |")
    lines.append("")
    lines.append(f"- Merge confirmations across all skills: **{r['merge_confirmations_total']}** "
                 "(the checked-in `ask` rule on `gh pr merge` — fires per-merge in `default` mode "
                 "even when you typed `/ship`).")
    for s in TEAM_SKILLS:
        auq = r["autonomy"][s]["prompts_breakdown"]["askuserquestion"]
        if auq:
            lines.append(f"- /{s} decision prompts (AskUserQuestion): {auq}")
    lines.append("")
    lines.append("> **Autonomy** = autonomous actions ÷ (autonomous actions + prompts shown). "
                 "Low autonomy = the skill kept stopping for you. A merge confirmation on `/ship` "
                 "is by design (the merge is the one irreversible act); running `/ship` in `auto` "
                 "mode auto-approves it, at the cost of that safety gate. Prompts/actions counted "
                 "here are attributed to the emitting skill — delegated sub-runs land under the "
                 "child skill (`/commit`, `/pr`).")
    lines.append("")
    lines.append("## Step 0 natural-language intent gate  ← the likely friction point")
    lines.append("")
    lines.append(f"- Gate fired: **{g['fired_total']}** times "
                 f"(by skill: {g['by_skill'] or '—'})")
    lines.append(f"- Natural-language runs: **{g['natural_language_runs']}** "
                 f"→ gate fired per NL run: **{g['fired_per_nl_run']}**")
    lines.append(f"- Answers chosen: {g['answers'] or '—'}")
    lines.append(f"- Opt-out file present (`{OPTOUT_REL}`): **{g['optout_file_present']}**")
    lines.append("")
    if g["fired_total"] and not g["optout_file_present"]:
        proceeds = g["answers"].get("Proceed", 0)
        if proceeds and proceeds >= max(1, g["fired_total"] // 2):
            lines.append(f"> The gate fired {g['fired_total']}× and you chose plain **Proceed** "
                         f"{proceeds}× while the opt-out file is absent. If those confirms feel "
                         f"redundant, choosing **“Proceed and don't ask again”** once (or creating "
                         f"`{OPTOUT_REL}`) suppresses just the Step 0 confirm — the real payload "
                         f"approval still runs.")
            lines.append("")
    lines.append("## Permission mode")
    lines.append("")
    lines.append(f"- Message distribution: {r['permission_modes'] or '—'}")
    lines.append("  (`default` prompts most; `acceptEdits`/`auto` prompt less. If most flow is in "
                 "`default`, some of the friction is permission prompts, not the Skills.)")
    lines.append("")
    sd = r["skill_discovery"]
    lines.append("## Skill-discovery — recurring workflows that could become skills")
    lines.append("")
    lines.append("Frequent, cross-session command shapes are candidate automations. "
                 f"Skills already covering some of this: {sd['existing_skills'] or '—'}.")
    lines.append("")
    if sd["top_command_signatures"]:
        lines.append("| Command shape | Times | In sessions |")
        lines.append("|---|--:|--:|")
        for row in sd["top_command_signatures"][:12]:
            lines.append(f"| `{row['signature']}` | {row['count']} | {row['sessions']} |")
        lines.append("")
    if sd["recurring_sequences"]:
        lines.append("**Recurring sequences** (agent ran B right after A, ≥2×) — the strongest "
                     "hints at a multi-step workflow worth wrapping:")
        lines.append("")
        for row in sd["recurring_sequences"][:10]:
            lines.append(f"- `{row['sequence']}` ×{row['count']}")
        lines.append("")
    lines.append(f"- Tool mix: {sd['tool_mix'] or '—'}")
    lines.append("")
    lines.append("> These are mechanical signals (what commands recur), not proposals. The "
                 "companion prompt in `PROMPT.md` reads the sessions semantically and turns these "
                 "into concrete candidate-skill suggestions (trigger + step outline), skipping "
                 "anything the existing skills already cover.")
    lines.append("")
    lines.append("## Environment")
    lines.append("")
    lines.append(f"- Claude Code versions seen: {r['claude_code_versions'] or '—'}")
    lines.append(f"- API error messages in window: {r['api_error_messages']}")
    if r.get("other_skills_seen"):
        lines.append(f"- Other skills seen: {r['other_skills_seen']}")
    if "branches" in r:
        lines.append(f"- Branches: {r['branches']}")
    lines.append("")
    lines.append("_No prompts, replies, code, or diffs are included in this report._")
    lines.append("")
    return "\n".join(lines)


def main(argv=None):
    ap = argparse.ArgumentParser(description="Diagnose /commit /pr /ship Skill usage from local transcripts.")
    ap.add_argument("--project-dir", type=Path, default=None,
                    help="Transcript dir (default: derived from the current repo path).")
    ap.add_argument("--scan-all", action="store_true",
                    help="Scan every ~/.claude/projects/* dir instead of just this repo's.")
    ap.add_argument("--since", default=None, help="Only include activity newer than e.g. 30d, 48h, 2w.")
    ap.add_argument("--include-branches", action="store_true",
                    help="Include git branch names in the output (off by default for privacy).")
    ap.add_argument("--out", type=Path, default=None, help="Output basename (default: skill-diag-<date>).")
    ap.add_argument("--stdout", action="store_true", help="Print the markdown report only; write no files.")
    ap.add_argument("--top", type=int, default=20, help="How many command shapes/sequences to keep (default 20).")
    args = ap.parse_args(argv)

    # Windows consoles default to cp1252; the report uses arrows/quotes. Force UTF-8.
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[attr-defined]
        except (AttributeError, ValueError):
            pass

    since = parse_since(args.since)
    files = collect_files(args.project_dir, args.scan_all)
    if not files:
        raise SystemExit("No transcripts found. Pass --project-dir or run from the repo you use the Skills in.")

    acc = Accumulator(since)
    for f in files:
        acc.add_session(f)

    report = build_report(acc, Path(os.getcwd()), args.include_branches, top_n=args.top)
    md = render_markdown(report)

    if args.stdout:
        print(md)
        return 0

    if args.out:
        base = args.out
    else:
        # Default into the tool's own out/ dir (resolved from this file, not the CWD) so
        # generated reports never land loose in the repo and can't be committed by accident.
        stamp = datetime.now(timezone.utc).strftime("%Y-%m-%d")  # match generated_at (UTC)
        base = Path(__file__).resolve().parent / "out" / f"skill-diag-{stamp}"
    base.parent.mkdir(parents=True, exist_ok=True)
    json_path = base.with_suffix(".json")
    md_path = base.with_suffix(".md")
    json_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
    md_path.write_text(md, encoding="utf-8")
    print(md)
    print(f"\nWrote {md_path} and {json_path}", file=sys.stderr)
    print("Review both, then share them with Blake if you're comfortable.", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
