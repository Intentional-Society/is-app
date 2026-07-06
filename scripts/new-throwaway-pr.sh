#!/usr/bin/env bash
#
# Open small, short-lived PRs with plausible filler content against a target repo.
#
# Creates one or more tiny branches, each adding a single mundane-looking file
# (working notes, a small helper module, a small data file), pushes them, and
# opens a PR for each via the GitHub CLI.
#
# Design constraint: nothing in the generated content announces itself as
# synthetic. There are no "test", "fixture", "dummy", or lorem-ipsum markers,
# because those would bias any automated reviewer/agent evaluated against the
# PR. Instead, every PR is tagged for *humans* two ways:
#   1. An 8-hex "ref" token embedded innocuously in the file (a footer line, a
#      code comment, or a "revision" field) and in the branch name.
#   2. A local ledger (JSON, default ~/.throwaway-prs.json) mapping each created
#      PR URL to its token, so you can audit and bulk-close later.
#
# Run with --cleanup to close every ledgered PR for the target repo and delete
# its branch.
#
# Requirements: git, GitHub CLI (gh) authenticated with push access, and jq.
# Point --repo-path at a sandbox/scratch clone — every run pushes branches and
# opens real PRs there. The JSON ledger format is shared with the PowerShell and
# Python siblings, so the three scripts are interchangeable.
#
# Usage:
#   new-throwaway-pr.sh [--repo-path DIR] [--base-branch BR] [--branch-prefix P]
#                       [--content-dir DIR] [--count N] [--draft]
#                       [--ledger-path FILE]
#   new-throwaway-pr.sh --cleanup [--repo-path DIR] [--ledger-path FILE]

set -euo pipefail

REPO_PATH="$(pwd)"
BASE_BRANCH=""
BRANCH_PREFIX="chore"
CONTENT_DIR="notes"
COUNT=1
DRAFT=0
LEDGER_PATH="${HOME}/.throwaway-prs.json"
CLEANUP=0

die() { echo "$*" >&2; exit 1; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo-path)     REPO_PATH="$2"; shift 2 ;;
    --base-branch)   BASE_BRANCH="$2"; shift 2 ;;
    --branch-prefix) BRANCH_PREFIX="$2"; shift 2 ;;
    --content-dir)   CONTENT_DIR="$2"; shift 2 ;;
    --count)         COUNT="$2"; shift 2 ;;
    --draft)         DRAFT=1; shift ;;
    --ledger-path)   LEDGER_PATH="$2"; shift 2 ;;
    --cleanup)       CLEANUP=1; shift ;;
    -h|--help)       sed -n '2,30p' "$0"; exit 0 ;;
    *)               die "unknown argument: $1" ;;
  esac
done

command -v git >/dev/null || die "git is not on PATH."
command -v gh  >/dev/null || die "GitHub CLI (gh) is not on PATH."
command -v jq  >/dev/null || die "jq is not on PATH."
[[ -d "$REPO_PATH/.git" ]] || die "$REPO_PATH is not a git repository."
[[ "$COUNT" =~ ^[0-9]+$ && "$COUNT" -ge 1 && "$COUNT" -le 20 ]] || die "--count must be between 1 and 20."

git_() { git -C "$REPO_PATH" "$@"; }
new_token() { printf '%08x' $(( RANDOM * RANDOM & 0xffffffff )); }

REPO_NAME="$(cd "$REPO_PATH" && gh repo view --json nameWithOwner --jq '.nameWithOwner')" \
  || die "gh can't resolve the repo at $REPO_PATH (is gh authenticated?)."

# ---------------------------------------------------------------------------
# Content templates
# ---------------------------------------------------------------------------
# render_template <slug> <token> <content-dir> emits "<relative-path>\n<body...>"
# (path on the first line, file body on the rest). Each body is small, self-
# contained, and plausibly mundane; the token rides along as an unremarkable
# ref/revision marker — obvious to a human who greps for it, invisible as intent
# to a reviewer who doesn't.

TEMPLATE_SLUGS=(retry-backoff meeting-cadence string-case overlap-window tz-offsets glossary)

template_title() {
  case "$1" in
    retry-backoff)   echo "docs: add working notes on retry backoff" ;;
    meeting-cadence) echo "docs: capture notes on sync meeting cadence" ;;
    string-case)     echo "chore: add string casing helpers" ;;
    overlap-window)  echo "chore: add hour-overlap helper for scheduling" ;;
    tz-offsets)      echo "chore: add timezone offset reference data" ;;
    glossary)        echo "docs: start a shared glossary" ;;
  esac
}

template_body() {
  case "$1" in
    retry-backoff)   echo "Writing these down while the discussion is fresh. Notes only, no code paths touched." ;;
    meeting-cadence) echo "Small standalone notes file so this stops living only in chat scrollback." ;;
    string-case)     echo "Two small pure helpers, no imports, nothing wired up yet." ;;
    overlap-window)  echo "Pure function, standalone file; wiring it into the scheduler comes separately." ;;
    tz-offsets)      echo "Static reference data for the scheduling discussion; nothing reads it yet." ;;
    glossary)        echo "Seeding this with the terms that keep needing re-explaining; additions welcome." ;;
  esac
}

template_path() {
  local slug="$1" token="$2" dir="$3"
  case "$slug" in
    retry-backoff)   echo "$dir/retry-backoff-$token.md" ;;
    meeting-cadence) echo "$dir/meeting-cadence-$token.md" ;;
    string-case)     echo "$dir/string-case-$token.js" ;;
    overlap-window)  echo "$dir/overlap-window-$token.js" ;;
    tz-offsets)      echo "$dir/tz-offsets-$token.json" ;;
    glossary)        echo "$dir/glossary-$token.md" ;;
  esac
}

template_text() {
  local slug="$1" t="$2"
  case "$slug" in
    retry-backoff)
      cat <<EOF
# Retry backoff notes

Points from the reliability discussion, so they're somewhere findable:

- Start at 200ms, double per attempt, cap at 30s.
- Add full jitter — synchronized retries were the whole problem last time.
- Give up after 6 attempts and surface the error; silent infinite retry hides outages.
- Idempotency keys on the write path before any of this matters.

Open question: whether the cap should be per-call or shared across a request's fan-out.

Ref: $t
EOF
      ;;
    meeting-cadence)
      cat <<EOF
# Sync meeting cadence

Current thinking on the recurring-call schedule:

- Alternate the weekly call between two slots so neither hemisphere always takes the 6am.
- Rotate note-taking; notes go in this folder within 24h.
- Anything requiring a decision gets an agenda line *before* the call, not during.
- Quarterly: revisit whether the second slot still matches where people actually are.

Ref: $t
EOF
      ;;
    string-case)
      cat <<EOF
// ref: $t

/** Convert a phrase to Title Case, leaving small connector words lowercase. */
export function titleCase(input) {
  const small = new Set(['a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'in', 'of', 'on', 'or', 'the', 'to']);
  return input
    .toLowerCase()
    .split(/\s+/)
    .map((word, i) =>
      i > 0 && small.has(word) ? word : word.charAt(0).toUpperCase() + word.slice(1),
    )
    .join(' ');
}

/** Collapse a phrase into a url-safe slug. */
export function slugify(input) {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+\$/g, '');
}
EOF
      ;;
    overlap-window)
      cat <<EOF
// ref: $t

/**
 * Given two [startHour, endHour) ranges on a 24h clock, return the number of
 * overlapping hours, treating ranges that wrap midnight correctly.
 */
export function overlapHours(a, b) {
  const expand = ([start, end]) => {
    const hours = [];
    for (let h = start; h !== end; h = (h + 1) % 24) hours.push(h);
    return new Set(hours);
  };
  const setA = expand(a);
  let count = 0;
  for (const h of expand(b)) if (setA.has(h)) count += 1;
  return count;
}
EOF
      ;;
    tz-offsets)
      cat <<EOF
{
  "revision": "$t",
  "zones": [
    { "city": "Auckland", "iana": "Pacific/Auckland", "utcOffsetStd": 12 },
    { "city": "Berlin", "iana": "Europe/Berlin", "utcOffsetStd": 1 },
    { "city": "Bogota", "iana": "America/Bogota", "utcOffsetStd": -5 },
    { "city": "Nairobi", "iana": "Africa/Nairobi", "utcOffsetStd": 3 },
    { "city": "San Francisco", "iana": "America/Los_Angeles", "utcOffsetStd": -8 }
  ]
}
EOF
      ;;
    glossary)
      cat <<EOF
# Glossary

Terms that keep coming up with slightly different meanings depending on who's talking.

- **Cohort** — a group admitted in the same intake window, not a program group.
- **Lane** — an isolated parallel dev environment (own DB stack and ports).
- **Check-in** — the weekly written update, distinct from the live call.
- **Steward** — the member responsible for a program's continuity, not its content.

Ref: $t
EOF
      ;;
  esac
}

ensure_ledger() { [[ -f "$LEDGER_PATH" ]] || echo '[]' > "$LEDGER_PATH"; }

# ---------------------------------------------------------------------------
# Cleanup mode
# ---------------------------------------------------------------------------
if [[ "$CLEANUP" -eq 1 ]]; then
  ensure_ledger
  mapfile -t urls < <(jq -r --arg r "$REPO_NAME" '.[] | select(.repo == $r) | .prUrl' "$LEDGER_PATH")
  if [[ "${#urls[@]}" -eq 0 ]]; then
    echo "Ledger has no entries for $REPO_NAME — nothing to clean up."
    exit 0
  fi
  for url in "${urls[@]}"; do
    token="$(jq -r --arg u "$url" '.[] | select(.prUrl == $u) | .token' "$LEDGER_PATH")"
    echo "Closing $url (ref $token)..."
    if ! (cd "$REPO_PATH" && gh pr close "$url" --delete-branch); then
      echo "  warning: could not close $url (already closed/merged?). Removing from ledger anyway." >&2
    fi
  done
  tmp="$(mktemp)"
  jq --arg r "$REPO_NAME" '[.[] | select(.repo != $r)]' "$LEDGER_PATH" > "$tmp" && mv "$tmp" "$LEDGER_PATH"
  n="${#urls[@]}"
  echo "Done. Removed $n entr$([[ "$n" -eq 1 ]] && echo y || echo ies) from $LEDGER_PATH."
  exit 0
fi

# ---------------------------------------------------------------------------
# Create mode
# ---------------------------------------------------------------------------
[[ -z "$(git_ status --porcelain)" ]] || die "Working tree at $REPO_PATH is not clean. Commit or stash first."

if [[ -z "$BASE_BRANCH" ]]; then
  git_ remote set-head origin --auto >/dev/null
  BASE_BRANCH="$(git_ symbolic-ref refs/remotes/origin/HEAD | sed 's#^refs/remotes/origin/##')"
fi

ORIGINAL_REF="$(git_ rev-parse --abbrev-ref HEAD)"
git_ fetch origin "$BASE_BRANCH" >/dev/null

ensure_ledger
created_branches=()
created_json='[]'

cleanup_local() {
  git_ switch "$ORIGINAL_REF" >/dev/null 2>&1 || true
  for br in "${created_branches[@]}"; do
    git_ branch -D "$br" >/dev/null 2>&1 || true
  done
  if [[ "$created_json" != '[]' ]]; then
    tmp="$(mktemp)"
    jq --argjson add "$created_json" '. + $add' "$LEDGER_PATH" > "$tmp" && mv "$tmp" "$LEDGER_PATH"
    local n; n="$(jq 'length' <<<"$created_json")"
    echo ""
    echo "Recorded $n PR(s) in $LEDGER_PATH. Close them all later with:"
    echo "  $0 --repo-path \"$REPO_PATH\" --cleanup"
  fi
}
trap cleanup_local EXIT

for (( i=1; i<=COUNT; i++ )); do
  slug="${TEMPLATE_SLUGS[$(( RANDOM % ${#TEMPLATE_SLUGS[@]} ))]}"
  token="$(new_token)"
  branch="$BRANCH_PREFIX/$slug-$token"
  rel_path="$(template_path "$slug" "$token" "$CONTENT_DIR")"
  abs_path="$REPO_PATH/$rel_path"

  echo "[$i/$COUNT] $branch -> $rel_path"

  git_ switch -c "$branch" "origin/$BASE_BRANCH" >/dev/null 2>&1
  created_branches+=("$branch")

  mkdir -p "$(dirname "$abs_path")"
  template_text "$slug" "$token" > "$abs_path"

  git_ add -- "$rel_path"
  git_ commit -m "$(template_title "$slug")" >/dev/null

  # Push with a small backoff on transient network failures.
  pushed=0
  for delay in 0 2 4 8; do
    [[ "$delay" -gt 0 ]] && sleep "$delay"
    if git_ push -u origin "$branch" >/dev/null 2>&1; then pushed=1; break; fi
  done
  [[ "$pushed" -eq 1 ]] || die "push failed for $branch after retries."

  gh_args=(pr create --base "$BASE_BRANCH" --head "$branch"
           --title "$(template_title "$slug")" --body "$(template_body "$slug")")
  [[ "$DRAFT" -eq 1 ]] && gh_args+=(--draft)
  pr_url="$(cd "$REPO_PATH" && gh "${gh_args[@]}")" || die "gh pr create failed for $branch."

  entry="$(jq -n \
    --arg repo "$REPO_NAME" --arg prUrl "$pr_url" --arg branch "$branch" \
    --arg token "$token" --arg file "$rel_path" \
    --arg createdAt "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    '{repo:$repo, prUrl:$prUrl, branch:$branch, token:$token, file:$file, createdAt:$createdAt}')"
  created_json="$(jq --argjson e "$entry" '. + [$e]' <<<"$created_json")"
  echo "  opened $pr_url (ref $token)"
done
