#!/usr/bin/env python3
"""Open small, short-lived PRs with plausible filler content against a target repo.

Creates one or more tiny branches, each adding a single mundane-looking file
(working notes, a small helper module, a small data file), pushes them, and
opens a PR for each via the GitHub CLI.

Design constraint: nothing in the generated content announces itself as
synthetic. There are no "test", "fixture", "dummy", or lorem-ipsum markers,
because those would bias any automated reviewer/agent evaluated against the PR.
Instead, every PR is tagged for *humans* two ways:

  1. An 8-hex "ref" token embedded innocuously in the file (a footer line, a
     code comment, or a "revision" field) and in the branch name.
  2. A local ledger (JSON, default ~/.throwaway-prs.json) mapping each created
     PR URL to its token, so you can audit and bulk-close later.

Run with --cleanup to close every ledgered PR for the target repo and delete
its branch.

Requirements: git, GitHub CLI (gh) authenticated with push access to the
target repo. Point --repo-path at a sandbox/scratch clone — every run pushes
branches and opens real PRs there.

The JSON ledger format is shared with the PowerShell and Bash siblings, so the
three scripts are interchangeable for create and cleanup.
"""
from __future__ import annotations

import argparse
import json
import os
import random
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

DEFAULT_LEDGER = Path.home() / ".throwaway-prs.json"


# ---------------------------------------------------------------------------
# Content templates
# ---------------------------------------------------------------------------
# Each template produces one small, self-contained, plausibly mundane file.
# The token rides along as an unremarkable ref/revision marker — obvious to a
# human who greps for it, meaningless to a reviewer who doesn't.

TEMPLATES = [
    {
        "slug": "retry-backoff",
        "title": "docs: add working notes on retry backoff",
        "commit": "docs: add working notes on retry backoff",
        "body": "Writing these down while the discussion is fresh. Notes only, no code paths touched.",
        "filename": lambda d, t: f"{d}/retry-backoff-{t}.md",
        "text": lambda t: f"""# Retry backoff notes

Points from the reliability discussion, so they're somewhere findable:

- Start at 200ms, double per attempt, cap at 30s.
- Add full jitter — synchronized retries were the whole problem last time.
- Give up after 6 attempts and surface the error; silent infinite retry hides outages.
- Idempotency keys on the write path before any of this matters.

Open question: whether the cap should be per-call or shared across a request's fan-out.

Ref: {t}
""",
    },
    {
        "slug": "meeting-cadence",
        "title": "docs: capture notes on sync meeting cadence",
        "commit": "docs: capture notes on sync meeting cadence",
        "body": "Small standalone notes file so this stops living only in chat scrollback.",
        "filename": lambda d, t: f"{d}/meeting-cadence-{t}.md",
        "text": lambda t: f"""# Sync meeting cadence

Current thinking on the recurring-call schedule:

- Alternate the weekly call between two slots so neither hemisphere always takes the 6am.
- Rotate note-taking; notes go in this folder within 24h.
- Anything requiring a decision gets an agenda line *before* the call, not during.
- Quarterly: revisit whether the second slot still matches where people actually are.

Ref: {t}
""",
    },
    {
        "slug": "string-case",
        "title": "chore: add string casing helpers",
        "commit": "chore: add string casing helpers",
        "body": "Two small pure helpers, no imports, nothing wired up yet.",
        "filename": lambda d, t: f"{d}/string-case-{t}.js",
        "text": lambda t: f"""// ref: {t}

/** Convert a phrase to Title Case, leaving small connector words lowercase. */
export function titleCase(input) {{
  const small = new Set(['a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'in', 'of', 'on', 'or', 'the', 'to']);
  return input
    .toLowerCase()
    .split(/\\s+/)
    .map((word, i) =>
      i > 0 && small.has(word) ? word : word.charAt(0).toUpperCase() + word.slice(1),
    )
    .join(' ');
}}

/** Collapse a phrase into a url-safe slug. */
export function slugify(input) {{
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}}
""",
    },
    {
        "slug": "overlap-window",
        "title": "chore: add hour-overlap helper for scheduling",
        "commit": "chore: add hour-overlap helper for scheduling",
        "body": "Pure function, standalone file; wiring it into the scheduler comes separately.",
        "filename": lambda d, t: f"{d}/overlap-window-{t}.js",
        "text": lambda t: f"""// ref: {t}

/**
 * Given two [startHour, endHour) ranges on a 24h clock, return the number of
 * overlapping hours, treating ranges that wrap midnight correctly.
 */
export function overlapHours(a, b) {{
  const expand = ([start, end]) => {{
    const hours = [];
    for (let h = start; h !== end; h = (h + 1) % 24) hours.push(h);
    return new Set(hours);
  }};
  const setA = expand(a);
  let count = 0;
  for (const h of expand(b)) if (setA.has(h)) count += 1;
  return count;
}}
""",
    },
    {
        "slug": "tz-offsets",
        "title": "chore: add timezone offset reference data",
        "commit": "chore: add timezone offset reference data",
        "body": "Static reference data for the scheduling discussion; nothing reads it yet.",
        "filename": lambda d, t: f"{d}/tz-offsets-{t}.json",
        "text": lambda t: f"""{{
  "revision": "{t}",
  "zones": [
    {{ "city": "Auckland", "iana": "Pacific/Auckland", "utcOffsetStd": 12 }},
    {{ "city": "Berlin", "iana": "Europe/Berlin", "utcOffsetStd": 1 }},
    {{ "city": "Bogota", "iana": "America/Bogota", "utcOffsetStd": -5 }},
    {{ "city": "Nairobi", "iana": "Africa/Nairobi", "utcOffsetStd": 3 }},
    {{ "city": "San Francisco", "iana": "America/Los_Angeles", "utcOffsetStd": -8 }}
  ]
}}
""",
    },
    {
        "slug": "glossary",
        "title": "docs: start a shared glossary",
        "commit": "docs: start a shared glossary",
        "body": "Seeding this with the terms that keep needing re-explaining; additions welcome.",
        "filename": lambda d, t: f"{d}/glossary-{t}.md",
        "text": lambda t: f"""# Glossary

Terms that keep coming up with slightly different meanings depending on who's talking.

- **Cohort** — a group admitted in the same intake window, not a program group.
- **Lane** — an isolated parallel dev environment (own DB stack and ports).
- **Check-in** — the weekly written update, distinct from the live call.
- **Steward** — the member responsible for a program's continuity, not its content.

Ref: {t}
""",
    },
]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def git(repo_path: str, *args: str) -> str:
    result = subprocess.run(
        ["git", "-C", repo_path, *args],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        raise RuntimeError(
            f"git {' '.join(args)} failed:\n{result.stdout}{result.stderr}"
        )
    return result.stdout.strip()


def gh(repo_path: str, *args: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["gh", *args],
        cwd=repo_path,
        capture_output=True,
        text=True,
    )


def new_token() -> str:
    return "".join(random.choice("0123456789abcdef") for _ in range(8))


def read_ledger(path: Path) -> list:
    if path.exists():
        return json.loads(path.read_text() or "[]")
    return []


def write_ledger(path: Path, entries: list) -> None:
    path.write_text(json.dumps(entries, indent=2) + "\n")


def which(cmd: str) -> bool:
    return any(
        os.access(os.path.join(p, cmd), os.X_OK)
        for p in os.environ.get("PATH", "").split(os.pathsep)
        if p
    )


# ---------------------------------------------------------------------------
# Commands
# ---------------------------------------------------------------------------

def resolve_repo_name(repo_path: str) -> str:
    result = gh(repo_path, "repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner")
    if result.returncode != 0:
        raise RuntimeError(f"gh can't resolve the repo at {repo_path} (is gh authenticated?).")
    return result.stdout.strip()


def do_cleanup(args, repo_name: str) -> None:
    ledger_path = Path(args.ledger_path)
    ledger = read_ledger(ledger_path)
    mine = [e for e in ledger if e.get("repo") == repo_name]
    if not mine:
        print(f"Ledger has no entries for {repo_name} — nothing to clean up.")
        return
    remaining = [e for e in ledger if e.get("repo") != repo_name]
    for entry in mine:
        print(f"Closing {entry['prUrl']} (ref {entry['token']})...")
        result = gh(args.repo_path, "pr", "close", entry["prUrl"], "--delete-branch")
        if result.stdout.strip():
            print(f"  {result.stdout.strip()}")
        if result.returncode != 0:
            print(
                f"  warning: could not close {entry['prUrl']} "
                "(already closed/merged?). Removing from ledger anyway.",
                file=sys.stderr,
            )
    write_ledger(ledger_path, remaining)
    n = len(mine)
    print(f"Done. Removed {n} entr{'y' if n == 1 else 'ies'} from {ledger_path}.")


def do_create(args, repo_name: str) -> None:
    ledger_path = Path(args.ledger_path)

    if git(args.repo_path, "status", "--porcelain"):
        raise RuntimeError(f"Working tree at {args.repo_path} is not clean. Commit or stash first.")

    base = args.base_branch
    if not base:
        git(args.repo_path, "remote", "set-head", "origin", "--auto")
        head_ref = git(args.repo_path, "symbolic-ref", "refs/remotes/origin/HEAD")
        base = head_ref.replace("refs/remotes/origin/", "")

    original_ref = git(args.repo_path, "rev-parse", "--abbrev-ref", "HEAD")
    git(args.repo_path, "fetch", "origin", base)

    created: list = []
    try:
        for i in range(1, args.count + 1):
            template = random.choice(TEMPLATES)
            token = new_token()
            branch = f"{args.branch_prefix}/{template['slug']}-{token}"
            rel_path = template["filename"](args.content_dir, token)
            abs_path = Path(args.repo_path) / rel_path

            print(f"[{i}/{args.count}] {branch} -> {rel_path}")

            git(args.repo_path, "switch", "-c", branch, f"origin/{base}")

            abs_path.parent.mkdir(parents=True, exist_ok=True)
            abs_path.write_text(template["text"](token))

            git(args.repo_path, "add", "--", rel_path)
            git(args.repo_path, "commit", "-m", template["commit"])
            git(args.repo_path, "push", "-u", "origin", branch)

            gh_args = [
                "pr", "create", "--base", base, "--head", branch,
                "--title", template["title"], "--body", template["body"],
            ]
            if args.draft:
                gh_args.append("--draft")
            result = gh(args.repo_path, *gh_args)
            if result.returncode != 0:
                raise RuntimeError(f"gh pr create failed for {branch}:\n{result.stderr}")
            pr_url = result.stdout.strip()

            created.append({
                "repo": repo_name,
                "prUrl": pr_url,
                "branch": branch,
                "token": token,
                "file": rel_path,
                "createdAt": datetime.now(timezone.utc).isoformat(),
            })
            print(f"  opened {pr_url} (ref {token})")
    finally:
        # Always return to where the user started; generated branches live on the remote.
        git(args.repo_path, "switch", original_ref)
        for entry in created:
            subprocess.run(
                ["git", "-C", args.repo_path, "branch", "-D", entry["branch"]],
                capture_output=True,
            )
        if created:
            write_ledger(ledger_path, read_ledger(ledger_path) + created)
            print(f"\nRecorded {len(created)} PR(s) in {ledger_path}. Close them all later with:")
            print(f"  {sys.argv[0]} --repo-path \"{args.repo_path}\" --cleanup")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--repo-path", default=os.getcwd(),
                        help="Local clone of the target repo (default: cwd).")
    parser.add_argument("--base-branch", default=None,
                        help="Branch to fork from and target (default: origin/HEAD).")
    parser.add_argument("--branch-prefix", default="chore",
                        help="Prefix for generated branch names (default: chore).")
    parser.add_argument("--content-dir", default="notes",
                        help="Repo-relative dir the generated file lands in (default: notes).")
    parser.add_argument("--count", type=int, default=1,
                        help="How many PRs to create in one run (default: 1).")
    parser.add_argument("--draft", action="store_true", help="Open the PRs as drafts.")
    parser.add_argument("--ledger-path", default=str(DEFAULT_LEDGER),
                        help="Where to record created PRs (default: ~/.throwaway-prs.json).")
    parser.add_argument("--cleanup", action="store_true",
                        help="Close every ledgered PR for the target repo and prune the ledger.")
    args = parser.parse_args()

    if not which("git"):
        print("git is not on PATH.", file=sys.stderr)
        return 1
    if not which("gh"):
        print("GitHub CLI (gh) is not on PATH.", file=sys.stderr)
        return 1
    if not (Path(args.repo_path) / ".git").exists():
        print(f"{args.repo_path} is not a git repository.", file=sys.stderr)
        return 1
    if args.count < 1 or args.count > 20:
        print("--count must be between 1 and 20.", file=sys.stderr)
        return 1

    try:
        repo_name = resolve_repo_name(args.repo_path)
        if args.cleanup:
            do_cleanup(args, repo_name)
        else:
            do_create(args, repo_name)
    except RuntimeError as exc:
        print(str(exc), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
