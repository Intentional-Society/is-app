#requires -Version 5.1
<#
.SYNOPSIS
    Opens small, short-lived PRs with plausible filler content against a target repo.

.DESCRIPTION
    Creates one or more tiny branches, each adding a single mundane-looking file
    (working notes, a small helper module, a small data file), pushes them, and
    opens a PR for each via the GitHub CLI.

    Design constraint: nothing in the generated content announces itself as
    synthetic. There are no "test", "fixture", "dummy", or lorem-ipsum markers,
    because those would bias any automated reviewer/agent evaluated against the
    PR. Instead, every PR is tagged for *humans* two ways:

      1. An 8-hex "ref" token embedded innocuously in the file (a footer line,
         a code comment, or a "revision" field) and in the branch name.
      2. A local ledger (JSON, default ~/.throwaway-prs.json) mapping each
         created PR URL to its token, so you can audit and bulk-close later.

    Run with -Cleanup to close every ledgered PR for the target repo and delete
    its branch.

    Requirements: git, GitHub CLI (gh) authenticated with push access to the
    target repo. Point -RepoPath at a sandbox/scratch clone — every run pushes
    branches and opens real PRs there.

.PARAMETER RepoPath
    Local clone of the target repo. Defaults to the current directory.

.PARAMETER BaseBranch
    Branch to fork from and target with the PR. Auto-detected from
    origin/HEAD when omitted.

.PARAMETER BranchPrefix
    Prefix for generated branch names (default: chore). Branches look like
    <prefix>/<slug>-<token>.

.PARAMETER ContentDir
    Repo-relative directory the generated file is written into (default: notes).

.PARAMETER Count
    How many PRs to create in one run (default: 1). Each gets its own branch,
    template, and token.

.PARAMETER Draft
    Open the PRs as drafts.

.PARAMETER LedgerPath
    Where to record created PRs (default: ~/.throwaway-prs.json).

.PARAMETER Cleanup
    Instead of creating PRs, close every ledgered PR belonging to the target
    repo (deleting its branch) and prune those entries from the ledger.

.EXAMPLE
    ./new-throwaway-pr.ps1 -RepoPath C:\src\scratch-repo -Count 3

.EXAMPLE
    ./new-throwaway-pr.ps1 -RepoPath C:\src\scratch-repo -Draft -BranchPrefix docs

.EXAMPLE
    ./new-throwaway-pr.ps1 -RepoPath C:\src\scratch-repo -Cleanup
#>
[CmdletBinding(DefaultParameterSetName = 'Create')]
param(
    [string]$RepoPath = (Get-Location).Path,

    [Parameter(ParameterSetName = 'Create')]
    [string]$BaseBranch,

    [Parameter(ParameterSetName = 'Create')]
    [string]$BranchPrefix = 'chore',

    [Parameter(ParameterSetName = 'Create')]
    [string]$ContentDir = 'notes',

    [Parameter(ParameterSetName = 'Create')]
    [ValidateRange(1, 20)]
    [int]$Count = 1,

    [Parameter(ParameterSetName = 'Create')]
    [switch]$Draft,

    [string]$LedgerPath = (Join-Path ([Environment]::GetFolderPath('UserProfile')) '.throwaway-prs.json'),

    [Parameter(ParameterSetName = 'Cleanup', Mandatory = $true)]
    [switch]$Cleanup
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

function Invoke-Git {
    param([Parameter(Mandatory)][string[]]$GitArgs)
    $out = & git -C $RepoPath @GitArgs 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "git $($GitArgs -join ' ') failed:`n$($out -join "`n")"
    }
    return $out
}

function New-Token {
    -join (1..8 | ForEach-Object { '{0:x}' -f (Get-Random -Maximum 16) })
}

function Read-Ledger {
    if (Test-Path $LedgerPath) {
        return @(Get-Content $LedgerPath -Raw | ConvertFrom-Json)
    }
    return @()
}

function Write-Ledger {
    param($Entries)
    ConvertTo-Json @($Entries) -Depth 5 | Set-Content $LedgerPath -Encoding UTF8
}

# ---------------------------------------------------------------------------
# Content templates
# ---------------------------------------------------------------------------
# Each template produces one small, self-contained, plausibly mundane file.
# The token rides along as an unremarkable ref/revision marker — obvious to a
# human who greps for it, meaningless to a reviewer who doesn't.

$templates = @(
    @{
        Slug   = 'retry-backoff'
        Title  = 'docs: add working notes on retry backoff'
        Commit = 'docs: add working notes on retry backoff'
        Body   = 'Writing these down while the discussion is fresh. Notes only, no code paths touched.'
        File   = { param($dir, $token) Join-Path $dir "retry-backoff-$token.md" }
        Text   = {
            param($token)
            @"
# Retry backoff notes

Points from the reliability discussion, so they're somewhere findable:

- Start at 200ms, double per attempt, cap at 30s.
- Add full jitter — synchronized retries were the whole problem last time.
- Give up after 6 attempts and surface the error; silent infinite retry hides outages.
- Idempotency keys on the write path before any of this matters.

Open question: whether the cap should be per-call or shared across a request's fan-out.

Ref: $token
"@
        }
    },
    @{
        Slug   = 'meeting-cadence'
        Title  = 'docs: capture notes on sync meeting cadence'
        Commit = 'docs: capture notes on sync meeting cadence'
        Body   = 'Small standalone notes file so this stops living only in chat scrollback.'
        File   = { param($dir, $token) Join-Path $dir "meeting-cadence-$token.md" }
        Text   = {
            param($token)
            @"
# Sync meeting cadence

Current thinking on the recurring-call schedule:

- Alternate the weekly call between two slots so neither hemisphere always takes the 6am.
- Rotate note-taking; notes go in this folder within 24h.
- Anything requiring a decision gets an agenda line *before* the call, not during.
- Quarterly: revisit whether the second slot still matches where people actually are.

Ref: $token
"@
        }
    },
    @{
        Slug   = 'string-case'
        Title  = 'chore: add string casing helpers'
        Commit = 'chore: add string casing helpers'
        Body   = 'Two small pure helpers, no imports, nothing wired up yet.'
        File   = { param($dir, $token) Join-Path $dir "string-case-$token.js" }
        Text   = {
            param($token)
            @"
// ref: $token

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
    .replace(/^-+|-+$/g, '');
}
"@
        }
    },
    @{
        Slug   = 'overlap-window'
        Title  = 'chore: add hour-overlap helper for scheduling'
        Commit = 'chore: add hour-overlap helper for scheduling'
        Body   = 'Pure function, standalone file; wiring it into the scheduler comes separately.'
        File   = { param($dir, $token) Join-Path $dir "overlap-window-$token.js" }
        Text   = {
            param($token)
            @"
// ref: $token

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
"@
        }
    },
    @{
        Slug   = 'tz-offsets'
        Title  = 'chore: add timezone offset reference data'
        Commit = 'chore: add timezone offset reference data'
        Body   = 'Static reference data for the scheduling discussion; nothing reads it yet.'
        File   = { param($dir, $token) Join-Path $dir "tz-offsets-$token.json" }
        Text   = {
            param($token)
            @"
{
  "revision": "$token",
  "zones": [
    { "city": "Auckland", "iana": "Pacific/Auckland", "utcOffsetStd": 12 },
    { "city": "Berlin", "iana": "Europe/Berlin", "utcOffsetStd": 1 },
    { "city": "Bogota", "iana": "America/Bogota", "utcOffsetStd": -5 },
    { "city": "Nairobi", "iana": "Africa/Nairobi", "utcOffsetStd": 3 },
    { "city": "San Francisco", "iana": "America/Los_Angeles", "utcOffsetStd": -8 }
  ]
}
"@
        }
    },
    @{
        Slug   = 'glossary'
        Title  = 'docs: start a shared glossary'
        Commit = 'docs: start a shared glossary'
        Body   = 'Seeding this with the terms that keep needing re-explaining; additions welcome.'
        File   = { param($dir, $token) Join-Path $dir "glossary-$token.md" }
        Text   = {
            param($token)
            @"
# Glossary

Terms that keep coming up with slightly different meanings depending on who's talking.

- **Cohort** — a group admitted in the same intake window, not a program group.
- **Lane** — an isolated parallel dev environment (own DB stack and ports).
- **Check-in** — the weekly written update, distinct from the live call.
- **Steward** — the member responsible for a program's continuity, not its content.

Ref: $token
"@
        }
    }
)

# ---------------------------------------------------------------------------
# Preflight
# ---------------------------------------------------------------------------

if (-not (Get-Command git -ErrorAction SilentlyContinue)) { throw 'git is not on PATH.' }
if (-not (Get-Command gh -ErrorAction SilentlyContinue)) { throw 'GitHub CLI (gh) is not on PATH.' }
if (-not (Test-Path (Join-Path $RepoPath '.git'))) { throw "$RepoPath is not a git repository." }

Push-Location $RepoPath
try {
    $repoName = & gh repo view --json nameWithOwner --jq '.nameWithOwner'
    if ($LASTEXITCODE -ne 0) { throw "gh can't resolve the repo at $RepoPath (is gh authenticated?)." }
}
finally { Pop-Location }

# ---------------------------------------------------------------------------
# Cleanup mode
# ---------------------------------------------------------------------------

if ($Cleanup) {
    $ledger = Read-Ledger
    $mine = @($ledger | Where-Object { $_.repo -eq $repoName })
    if ($mine.Count -eq 0) {
        Write-Host "Ledger has no entries for $repoName — nothing to clean up."
        return
    }
    $remaining = @($ledger | Where-Object { $_.repo -ne $repoName })
    foreach ($entry in $mine) {
        Write-Host "Closing $($entry.prUrl) (ref $($entry.token))..."
        & gh pr close $entry.prUrl --delete-branch 2>&1 | ForEach-Object { Write-Host "  $_" }
        if ($LASTEXITCODE -ne 0) {
            Write-Warning "Could not close $($entry.prUrl) (already closed/merged?). Removing from ledger anyway."
        }
    }
    Write-Ledger $remaining
    Write-Host "Done. Removed $($mine.Count) entr$(if ($mine.Count -eq 1) { 'y' } else { 'ies' }) from $LedgerPath."
    return
}

# ---------------------------------------------------------------------------
# Create mode
# ---------------------------------------------------------------------------

$dirty = Invoke-Git @('status', '--porcelain')
if ($dirty) { throw "Working tree at $RepoPath is not clean. Commit or stash first." }

if (-not $BaseBranch) {
    Invoke-Git @('remote', 'set-head', 'origin', '--auto') | Out-Null
    $headRef = (Invoke-Git @('symbolic-ref', 'refs/remotes/origin/HEAD')) -join ''
    $BaseBranch = $headRef -replace '^refs/remotes/origin/', ''
}

$originalRef = (Invoke-Git @('rev-parse', '--abbrev-ref', 'HEAD')) -join ''
Invoke-Git @('fetch', 'origin', $BaseBranch) | Out-Null

$created = @()
try {
    for ($i = 1; $i -le $Count; $i++) {
        $template = $templates | Get-Random
        $token = New-Token
        $branch = "$BranchPrefix/$($template.Slug)-$token"
        $relPath = & $template.File $ContentDir $token
        $absPath = Join-Path $RepoPath $relPath

        Write-Host "[$i/$Count] $branch -> $relPath"

        Invoke-Git @('switch', '-c', $branch, "origin/$BaseBranch") | Out-Null

        $dir = Split-Path $absPath -Parent
        if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
        $text = (& $template.Text $token) -replace "`r`n", "`n"
        [System.IO.File]::WriteAllText($absPath, $text + "`n")

        Invoke-Git @('add', '--', $relPath) | Out-Null
        Invoke-Git @('commit', '-m', $template.Commit) | Out-Null
        Invoke-Git @('push', '-u', 'origin', $branch) | Out-Null

        $ghArgs = @('pr', 'create', '--base', $BaseBranch, '--head', $branch,
            '--title', $template.Title, '--body', $template.Body)
        if ($Draft) { $ghArgs += '--draft' }
        Push-Location $RepoPath
        try {
            $prUrl = (& gh @ghArgs) -join ''
            if ($LASTEXITCODE -ne 0) { throw "gh pr create failed for $branch." }
        }
        finally { Pop-Location }

        $created += [pscustomobject]@{
            repo      = $repoName
            prUrl     = $prUrl
            branch    = $branch
            token     = $token
            file      = $relPath
            createdAt = (Get-Date).ToUniversalTime().ToString('o')
        }
        Write-Host "  opened $prUrl (ref $token)"
    }
}
finally {
    # Always return to where the user started; generated branches live on the remote.
    Invoke-Git @('switch', $originalRef) | Out-Null
    foreach ($entry in $created) {
        & git -C $RepoPath branch -D $entry.branch 2>&1 | Out-Null
    }
    if ($created.Count -gt 0) {
        Write-Ledger (@(Read-Ledger) + $created)
        Write-Host "`nRecorded $($created.Count) PR(s) in $LedgerPath. Close them all later with:"
        Write-Host "  ./new-throwaway-pr.ps1 -RepoPath `"$RepoPath`" -Cleanup"
    }
}
