# Hub Coordination on a Ticket Tree ("the pen")

> **Status: DRAFT, parked 2026-10-29.** Drafted by an AI agent session on Blake's behalf; not yet
> reviewed or approved by him. Branch `claude/charming-hamilton-rz3em4`, no PR opened. Source: a
> reconstruction of the working agreement from issue #507's body and all 104 comments (chiefly the
> 2026-09-21 hand-off comment, sections 9 to 14, the burn-down authorization and AFK authorization 2,
> the /goal and its renewals), tickets #617, #619 and #621, and the agent definitions under
> `.claude/agents/`. Why: the skill-evals program invented this coordination pattern under time
> pressure and recorded it only in issue comments; #621's close-out will scrub session names from
> #507's Current-state block, so the registration procedure was about to survive only in comment
> history. This doc lifts it into the repo as a reusable strategy before that happens. Peer-reviewed
> on 2026-10-29 by four persona agents against the record (findings and dispositions are in the last
> section); still unreviewed against a second program. "Someday" on #507 lists "hub-pattern →
> reusable skill" as the next step if there is appetite.

How to run a multi-session, multi-agent work program off one GitHub issue so that any fresh session
can resume it cold and no two sessions ever fight over the record. This is the pattern the
skill-evals program ran on issue #507 from July to October 2026; it is written up here so the next
program can reuse it without re-deriving it. It has run once. Treat every prescription below as a
tested hypothesis, not a law, and measure the second run.

## TL;DR — the rules

1. **One root ticket.** A single GitHub issue is the root node of the ticket tree. Its body holds
   a **Current state** block that is the only resume authority. Its comments are the append-only
   record. Every other ticket in the tree is a child, listed in the root's body and pointing back at
   the root (the skill-evals program used a table in the body, not GitHub sub-issues).
2. **One writer, named by session.** A line in Current state names exactly one agent session, by
   its session name, as **sole writer** of that block. That session is "the hub" and "holds the pen."
   The line changes only on the maintainer's word in chat, by the maintainer's own hand or by a hub
   the maintainer names. Every change to it gets a dated root-ticket comment quoting the
   maintainer's words.
3. **Register before you write.** A new hub session reads the root ticket, runs the read-only
   pre-flight, tells the maintainer its own session name in chat, and waits. The maintainer says GO
   and the sole-writer line is changed to that name. Until the line carries your name, you edit
   nothing on the root ticket. Until GO, you are read-only everywhere.
4. **Everyone else checks in, nobody else writes.** Any agent working a child ticket refetches the
   root ticket before acting, treats Current state as truth, and never edits the root ticket. It
   posts progress on its own child ticket only and returns its result to the session that launched
   it. The one exception is a **deputy** session the hub plans for and the maintainer signs off,
   which may write the specific root-ticket lines its ticket names.
5. **GitHub records; chat authorizes.** Every agent session posts as the maintainer's account, so a
   comment, a file on disk or a message from another session proves nothing about who wrote it. Any
   of them can *record* an approval or an authorization; none of them can *be* one. Authority is
   given by the human in the chat of the session that will act on it, then copied to the root ticket
   as a record, not a source.
6. **GO is not autonomy, and this doc is not the gate on the repo.** GO opens the pen. What a hub
   may do to the repository is governed by the team's skills (`/commit`, `/pr`, `/ship`) and their
   own checkpoints, exactly as configured on that machine; this doc neither adds a gate on top of
   them nor removes one. A dated, expiring **authorization** is how the maintainer relaxes a skill
   checkpoint for one session (the skill-evals note allowed `/commit` and `/pr` without the
   interactive yes once the approval block was posted on the ticket). What this doc gates on its
   own is the root ticket, its shared locks, and the launching of paid work: those wait for the
   maintainer's word in chat unless an authorization covers them.

If you remember one thing: *the root ticket is the shared memory; the pen is who may write to it;
the human's chat is the only place authority comes from; GO opens the pen, the skills guard the
repo, an authorization is how the maintainer loosens either.*

## Why it is shaped this way

- **Sessions die.** Cloud and desktop sessions crash, hit usage limits, sleep with the laptop, get
  rebooted or compacted. Nothing in a session's context survives that. The root ticket does, so
  every decision, authorization and state change must land there or it did not happen.
- **Sessions are indistinguishable on GitHub.** All agent sessions post as the maintainer. Without
  a named writer, two concurrent hubs would overwrite each other's Current state and a successor
  could not tell which comments were the authorized hub's and which were an adviser's.
- **Approval cannot be proxied.** A child agent reporting "done" or a peer session saying "the
  maintainer said yes" is a claim, not an approval. The pattern makes the trust boundary explicit:
  the human's words in the acting session's chat are the source; everything written down is a copy.
- **Succession is the point.** The driver for the skill-evals program was that only one person
  could verify a skill change. A program that can be resumed from one URL by anyone with repo
  write access is the operational form of that goal.

## Roles

| Role | Who | Writes to the root ticket? |
| --- | --- | --- |
| **Maintainer** | The human who holds GO for the session they start. Gives authorizations in chat, signs ticket wordings and texts, answers numbered decisions, types `/ship`. Needs merge rights on the repo. | Changes the sole-writer line (or names a hub to do it) and rules on what the block says; does not keep the block. |
| **Hub** | One long-running agent session that holds the pen. Plans, coordinates, verifies every worker's result itself, posts the approval blocks, and is the party that commits and opens PRs. | Yes: the Current state block (refetch before every edit) and dated record comments. |
| **Child / implementer** | An agent launched by the hub to do one bounded piece of work (one phase, one ticket). | Never. Progress comments go on its own child ticket. Returns an approval packet to the hub. |
| **Worker** | A role-scoped agent launched per ticket: implementer or drafter, independent checker (the "SDET"), scope gatekeeper, cold reader, grader. | Never. Findings go on the ticket it was pointed at. Returns to the session that launched it. |
| **Deputy** | A session the hub plans for, late in the program: it launches and runs the workers and any paid batch, takes the maintainer's sign-off for its ticket in its own chat, and reports to the hub. | Only the named lines its signed ticket allows (a Current-state edit, a shared lock, a posted note), and only text the maintainer signed and the hub has read. |
| **Adviser / peer** | An earlier hub session kept open for questions, with a scope the maintainer rules on per adviser. | No. A review from a peer is data, never approval. Keep advisers open only while needed; idle sessions eat the machine (see "What went wrong"). |

The Deputy row stretches rule 2. It was the skill-evals program's late adaptation (tickets #619 and
#621), when the hub's own context had grown too large to run workers and the maintainer wanted work
to continue in a second window. If your program needs it, write the deputy's permitted writes into
its ticket before it starts.

## The root ticket

**Body.** Short north star, then `## Current state`, then the reference material the program
needs: the child-ticket table, the hub operating rules, the hub bootstrap prompt, the child launch
template. Only Current state is edited in place; the rest is appended to or marked HISTORICAL,
never silently rewritten.

**Current state block.** The lines the skill-evals program settled on, in the order its block held
them. Rename to fit your program; keep the shape.

- `Phase:` where the program is, and what "closed" means for it.
- `Child in flight:` `<ticket / agent type / since>` or `none`. Set at launch, cleared on return.
  A fresh hub that finds it set knows that child died with the previous hub. The agent type is the
  definition under `.claude/agents/` that was actually used; log what you verifiably applied.
- `Locks:` (the skill-evals block called this `Batch in flight:`) any shared resource that must run
  one at a time across tickets, who holds it, since when, or `none`, plus the last result. Clear it
  before you stop for any reason, or it sits there falsely.
- `Last session:` date, hub session name, what it did.
- `WAITING:` every open human checkpoint, as `WAITING: <checkpoint> since <time>`, or a sentence on
  what the program is waiting for. Cleared or annotated when resolved.
- `Autonomy:` the sole-writer line (who holds the pen), which authorizations are live, what each
  supplements, and each one's expiry written into the line itself ("expires end of day X whatever
  this line says").
- `Remaining work, in order:` the ranked backlog by ticket number, with state, and the path of the
  hub's running log (per machine; the record is the ticket).
- `Working rules:` the maintainer's standing rules for this program, dated and attributed.
- `Inheritor:` who owns it next and from when (the skill-evals close-out renames this `Maintainer:`).
- `Binding comments:` the comment ids a successor must read: hand-offs, authorizations, plans of
  record. (The skill-evals block carried these inline in the Autonomy line; a line of their own is
  easier to find.)
- `Fast-follow:` or whatever your program calls its approved post-core work, by ticket.
- `Someday:` parked items as `item — why parked / what would unpark it`.
- `Dropped:` what was decided against, so nobody re-proposes it.

**Comments.** Append-only. From 2026-09-21 the skill-evals program opened every agent comment with
a fixed first line (`Posted by an AI agent session on <maintainer>'s behalf.`), on the maintainer's
instruction; earlier comments opened `**<date> — hub (<session name>):**`. Pick one and date it.
What gets a root-ticket comment changed over the program: in the nine-phase run the hub commented
every milestone (launch, return, checkpoint, acceptance, queue changes); in the burn-down the root
ticket held **records** only (authorizations and renewals, hand-offs, corrections, plans of record,
pen moves) while progress went into Current state lines and onto the child tickets. The later split
is the one to copy. Read comments by a route that returns all of them and check the count against
the issue's `comments` field; both the `gh` plain view and a single MCP page have silently dropped
the newest ones.

## Starting a program

The pattern as recorded starts mid-stream, with a predecessor. A program's first day looks
different, and the skill-evals record shows how it was actually done:

1. **The maintainer, or a planning session with the maintainer attending, files the root ticket**
   with the body skeleton above: north star, an empty Current state block whose sole-writer line
   reads `none`, the child-ticket table, the operating rules (including the Subagent Addendum
   below), and the hub bootstrap prompt in a fenced block with its own pre-flight ("the root ticket
   must be OPEN and titled X; if not, report and stop; never guess a different issue").
2. **Each child ticket embeds its own startup prompt** at the top of its body, plus acceptance
   criteria that define done. A child that cannot tell what done means from its ticket has found a
   packet bug and stops.
3. **An agent definition exists for the children** (`.claude/agents/<name>.md`, with model and
   effort), so the hub can log the type it actually launched.
4. **The first hub registers like any other**, below, with pre-flight row 3 expecting `none`.
   (In July 2026 the first hub was made sole writer by its launch prompt instead; the strict
   registration order dates from the 2026-09-21 hand-off. Prefer the registration.)

## Registering a new hub: claiming the pen

**Session name.** The short label the harness shows for your window in its session or peer
listing (the skill-evals names looked like `is-app-98`). It is per window, it changes when the
window restarts, and it is what the sole-writer line carries. Find yours and write it down before
anything else.

The hand-over is strictly ordered. Pre-flight row 3 below expects the **predecessor's** name on the
sole-writer line (or `none` for a first hub); that is a pass, not a finding.

1. **Read the record.** The root ticket's body, then the binding comments it names (hand-offs,
   authorizations, plans of record), then the repo instructions **from disk**, since the copy
   injected into a session can be stale. Read a predecessor's working folder if it is on this
   machine; never write in it, and never re-run its posting or editing scripts, which would re-post
   or re-edit the root ticket.
2. **Run the pre-flight.** Read-only, report-only. Note every surprise; fix nothing. A failed row
   is a finding for the maintainer, not work for you. Before GO you may only read, run read-only
   `git` and `gh … view/list`, launch read-only agents, and write notes under your working folder.
3. **Create your working folder** if it does not exist (layout below), with its README first. If it
   exists, read its `log.md` first; you are a successor.
4. **Write one page of understanding** in it: the tickets by name in the root ticket's order and
   what each needs; what is not yours; what needs the maintainer; what authority you have (none, at
   this point); what you verified live versus what you only read; discrepancies in the record; what
   you are unsure of, marked inline. No discrepancies and no unsure marks means you did not check.
5. **Get an independent cold read.** A fresh read-only agent that has seen none of this attempts
   your first unworked ticket from its issue body alone, logging every guess. Its guesses are the
   gaps in the record.
6. **Tell the maintainer your session name in chat**, bring the page, the cold read's findings and
   your questions, each numbered with a recommended answer they can paste back. Ask for the
   sole-writer line to be changed to your name. Until it is, write nothing on the root ticket,
   including any shared lock.
7. **GO arrives, the line changes, you hold the pen.** If GO arrives without the edit, ask for it
   before your first write. Post a dated root-ticket comment recording the pen move and quoting the
   maintainer's words. Write your **authority log line** in your running log at once: time, "given
   in chat by <maintainer>", what was given (GO alone, or GO plus which authorization), and the URL
   of the recorded copy once posted.
8. **If an authorization was given**, record it as a dated comment on the root ticket headed "a
   record, not the source", with its expiry in the text, and say in chat when you have.

**Restart versus succession.** If the same conversation comes back under a new window name, it is
not a successor: the maintainer may continue its authority with one line in chat ("authorization
continues for this session", "pen: <new name>"). Record that line and the new name on the root
ticket before your next write, and change the sole-writer line on the maintainer's word. A new
conversation is a successor and inherits nothing. Peers' names go stale the same way; ask the
maintainer which window is which rather than guessing.

### Pre-flight template

Adapt the commands and expected values to the program; the hand-off that brought you here should
state them. Rows marked report-only are never acted on before GO.

| # | Check | Command | Expected | If not |
| --- | --- | --- | --- | --- |
| 1 | Root ticket | `gh issue view <N> --json state,title,body` | OPEN; body has `## Current state` | Report exactly what is wrong and stop. Never guess another issue. |
| 2 | Recent record | the comments route, paged to the full count | The binding comments the hand-off names are present | You are reading a stale record. Stop and ask. |
| 3 | The pen | read the Autonomy line | Names your predecessor (or `none` for a first hub), not you | A name that is neither means someone else holds the pen. Stop and ask. |
| 4 | Branch / tree | `git branch --show-current`; `git status --porcelain=v1` | The branch your environment starts on (`main` on a laptop; a session branch in a cloud container); tree clean | Someone has work in flight. Find out whose. |
| 5 | Unpushed / HEAD | `git log origin/main..HEAD --oneline`; `git log -1 --format=%h origin/main` | Nothing ahead; HEAD at or after the SHA the hand-off records | Behind means an old clone. Stop and ask. |
| 6 | Branches / stash | `git branch -vv`; `git stash list` | Only the branches the hand-off lists; stash empty | Any other branch is a previous session's work: read it, never delete it. |
| 7 | Local hides | `cat .git/info/exclude` | Hides nothing relevant | A hide makes `git status` lie. Tell the maintainer. |
| 8 | Shared resources | a probe **from a script file** (count entries or print ABSENT) | Absent or idle | **Report only.** Anything there is evidence. Nothing is torn down before GO, and never with a bulk flag. |
| 9 | Open PRs | `gh pr list --state open` | Only the ones the hand-off names | A draft PR of the program's means you are resuming: read its whole conversation first. |
| 10 | The child tickets | `gh issue view <n>` for each the hand-off names | Exist, in the stated state; count how many | **Count only.** After GO, file only the missing ones and show the maintainer only the ones you wrote. A changed state means the backlog changed: ask. |
| 11 | Instructions | read `AGENTS.md` / `CLAUDE.md` from the checkout | The sections the hand-off names | The injected copy may be stale; prefer disk. |
| 12 | Working folder | `ls <scratch>/<program>/` | First hub: absent. Successor: present, with `README.md` and `log.md` | First hub: create it with its README before anything else. Successor: read `log.md` first. Missing on a successor means another machine: say so at once and carry on from the ticket. |

### The working folder

Per machine, gitignored, never cited by path in a ticket body (move content in, not paths). The
skill-evals layout, shared by every hub session of the program so the log stays continuous across
a forced hand-over:

```text
<scratch>/<program>/
  README.md      what each sub-folder is for, and which files must NOT be executed
  log.md         the running decision log: decisions with sources; the maintainer's instructions
                 verbatim with the time; the authority log line; things tried that failed.
                 In-flight line at the top
  tickets/       ticket drafts and their attempt logs
  issue-edits/   the script that made each root- or child-ticket edit, with pre and post snapshot
  posted/        every comment, approval block, commit message and PR body, saved before posting
  peers/         digests of peer replies
  reviews/       reviewer and checker reports
  sessions/<NN>-<session-name>/   this session's understanding page, journal and hand-off doc path
```

## Working a child ticket: the check-in obligation

This applies to every child and worker that touches any ticket in the tree, whoever launched it.

- **Refetch the root ticket before acting.** Current state is the authority. Re-check any line
  that changed since the date your launch prompt cites.
- **Never edit the root ticket**, body or comments. Your progress comments go on your own child
  ticket at each significant milestone, so your work is recoverable if the launching session dies.
  A worker pointed at a ticket posts its findings there.
- **Never commit, push, or open PRs.** Stop when your changes are prepared and tested and return
  an **approval packet** to the session that launched you: files changed, diffstat, proposed
  commit message, test evidence. Where a ticket or an embedded startup prompt says otherwise, the
  addendum wins; stop and say so. The hub turns the packet into an **approval block** posted on
  the ticket's own issue before `/commit` and again before `/pr`, with a human attending or under
  an authorization that names that exact step.
- **If you cannot tell what done means from your ticket, that is a packet bug.** Comment the gap
  on your ticket and stop. Do not improvise scope.
- **Independence.** An author never grades its own work; a checker never patches what it grades;
  scope is checked by a separate agent; one fix round from one numbered list, then stop; record
  disagreement rather than resolve it. Stopping and reporting is a success, for workers as for the
  hub.
- **Work synchronously.** A child has no mechanism to be woken when a background job finishes;
  if you background a batch and wait for a notification, your turn ends and the work is lost.
- **If relaunched or resumed**, your launch prompt says what already exists. Verify it before
  redoing anything. The hub's retry ceiling in the skill-evals program was one model-bump relaunch
  per phase; after that the maintainer is needed.
- **Open every comment with the agent header line** your program uses.

The hub appends the following to every launch prompt. The skill-evals wording, with the two
program-specific values made placeholders (it covered the commit, root-ticket and progress-comment
rules; the refetch rule was added by the burn-down tickets' working rules, so add it as item 0):

> You are running as a SUBAGENT of the program hub. Overrides to your embedded instructions:
> (0) refetch the root ticket (#\<ROOT\>) before acting and treat its Current state as the authority.
> (1) do NOT run /commit or /pr and never git commit/push — when your changes are prepared and
> tested, STOP and return an APPROVAL PACKET to the hub: files changed, diffstat, proposed commit
> message, test evidence. The hub ships with a human attending. (2) Never edit issue #\<ROOT\> (body
> or comments); append progress comments to YOUR ticket (#\<CHILD\>) only; your final report returns
> to the hub, which does all #\<ROOT\> writes. (3) Post a progress comment on your ticket at each
> significant milestone so your work is recoverable if the hub session dies.

Two words that are easy to confuse: the **delegation packet** is the child ticket plus its startup
prompt plus this addendum (what the child receives); the **approval packet** is what the child
returns.

## The hub's own discipline

- **Refetch before every edit** of Current state, and edit only that block. A stale body in your
  context will overwrite a deputy's or the maintainer's edit.
- **Verify, do not trust.** Re-run cheap deterministic checks yourself (validators, tests, file
  existence). For expensive artifacts (batches, benchmarks), audit the evidence the child cites and
  spot-check at least one item per evidence class. Accept no bare assertion without an artifact.
  This covers **your own probes** and every statement you relay to the maintainer: the skill-evals
  hub corrected its own statements to the maintainer at least six times.
- **Mark provenance on every fact you report:** "hub-verified" versus "agent-reported."
- **Pulse** in chat at every regain-control moment: what finished, what is running, what is next,
  what input is needed, led by a one-line status in a fixed format ("Plan step N of M: state.
  Next: step K. Your next input: X or none"). While the maintainer is away, pulse on a fixed clock
  (the /goal said every 20 minutes); no pulse means you are stuck or out of budget, and you say
  which as soon as you can.
- **Asks fit a phone.** Test names, not ids; numbered decisions, each with a recommended answer the
  maintainer can paste back; a one-line ask plus the exact text to paste; the issue link; never
  buried mid-paragraph. If nothing is acknowledged within the silence window the authorization sets
  (30 minutes in the skill-evals program), treat that item as failed, park it, and carry it to the
  evening message.
- **Propose, then record.** Test plans, PR text and ticket wording go to the maintainer first; the
  ticket comment records the approval they gave in chat.
- **WAITING lifecycle.** Set `WAITING: <checkpoint> since <time>` when blocked on a human; clear or
  annotate it when resolved. A resumed hub reconciles every stale WAITING line against actual PR,
  merge and checkpoint state before re-asking anyone.
- **Resume reconciliation.** If `Child in flight` is set when you take the pen, that child is dead.
  Audit `git status`, branches, open PRs and the child's workspace for partial work. Keep what is
  verifiably complete; never blindly redo actions that may already have mutated state (commits,
  PRs, comments). Relaunch with an explicit note of what already exists.
- **Checkpoint** at every milestone, before any long wait, and at least hourly: to the ticket's own
  issue, to the root's state lines, and to your running log. Each checkpoint carries decisions with
  sources, the maintainer's instructions verbatim with the time, things tried that failed, and an
  in-flight line (agents, branch, staged and unstaged, lock held, next intended action).
- **After any compaction, and at every ticket start:** `git status`, branch and `git stash list`
  first; list your running agents and reconcile them against the log; verify against disk or
  GitHub any text you are about to paste or rely on; re-read the rule block and the authorization.
- **Shared locks live on the root ticket.** Claim before you start, clear before you stop for any
  reason.
- **Stopping at a named exit is a success.** The authorization names the tripwires and the stop
  conditions; reaching one means post where you got to with a recommendation, set WAITING, and
  move to the next ticket. Removing the pressure to force a result was the single most valued
  feature of the delegation packets.

## Authority: record, not source

**What the skills already decide.** Repository actions have their own gates, checked in and
configured per machine, and this doc defers to them:

- `/commit` confirms natural-language intent (Step 0, which the per-machine opt-out file
  `.claude/skip-nl-confirm-commit-pr.local` skips) and then always presents one bundled approval
  block for a yes (Step 14). `/pr` is the same shape: optional intent confirmation, then a yes on
  the drafted title, body and reviewers.
- `/ship` is explicit-only, and the merge confirmation is the checked-in `ask` rule on
  `gh pr merge`, which fires in every permission mode and which no session setting can silence.

If a person has set those skills up so their agent may act with fewer prompts, this pattern does
not override that; if the skills require a yes, this pattern does not need to repeat it. The
pattern's own gates are the ones the skills do not cover: writes to the root ticket, its shared
locks, and launching paid work (eval batches, long agent runs).

Three states, in order of what they permit:

| State | What the hub may do |
| --- | --- |
| **Before GO** | Read only: the record, read-only `git` and `gh … view/list`, read-only agents, notes in its own working folder. |
| **GO, no live authorization** (also after every authorization has lapsed) | Holds the pen. Repository actions run under the skills' checkpoints as configured on that machine. Root-ticket edits beyond the pen hand-over, lock claims and paid launches wait for the maintainer's word in chat. The skill-evals program called this working **attended**, because on the maintainer's laptop the skills' defaults meant a yes per commit and per PR. |
| **GO plus a live authorization** | Acts unasked within the authorization's list, until its expiry, stopping on its tripwires. The list can relax a skill checkpoint for the session (not the merge rule, which is checked in by design) and can cover root-ticket writes, locks and launches. |

An **authorization** is a dated block the maintainer types into the acting session's chat. The hub
may draft it; the maintainer gives it. Its slots, from the skill-evals notes:

- Addressed to a named session ("you told me your name in this chat"), stating that it takes
  effect only when given in that chat and that the GitHub copy is a record.
- **What the hub may do unasked**, per approved ticket, named concretely (branch and push; run the
  gate; `/commit` and `/pr` without an interactive yes *provided* the approval block is posted on
  the ticket first, which is the maintainer relaxing those skills' checkpoints for this session;
  fix commits inside the ticket's acceptance; draft PRs only; edit Current state once the line
  names you).
- **What is reserved**, which the skill-evals maintainer stated as "still mine, always": `/ship`
  and every merge; anything touching `main` directly, including force-push and auto-merge; every
  branch deletion; approving every change to a skill's text or an eval's text; a second iteration
  on anything; any change to the plan or its order; anything outside the approved ticket list (a
  new ticket is a draft to the maintainer). Nothing merges or ships while the maintainer is away.
- **Never, whatever the ticket says:** editing settings, permissions, hooks, CI or workflow config,
  or dependencies; routing around a refusal or permission prompt (use only a fallback the
  maintainer already named, and notify them).
- **Precedence.** Where the maintainer's answer in chat and the recorded note disagree, chat wins.
  Where a ticket would grant what the note reserves, the note wins; where a ticket withholds what
  the note grants, the ticket wins; in both cases stop and ask. When two of the maintainer's rules
  collide, ask which one binds now.
- **Tripwires**, per ticket: fix rounds, discretionary runs, launch ceilings. Reaching one is a
  stop, not a failure.
- **Drift classes.** MECHANICAL (a formatter rewrote a file, a line number moved, a template
  renders differently): proceed and report in the approval block. Anything else is SUBSTANTIVE:
  stop and bring it to the maintainer.
- **The channel** for bringing the maintainer in (the skill-evals program used a phone
  notification with a one-line ask and the text to paste back) and the silence window after which
  an unanswered item counts as failed.
- **Hand-over and cut-off behaviour** (below), and the **expiry**, repeated in the recorded copy:
  "expires end of day X whatever this line says."

**Stacking.** Grants stack and each names what it supplements: the skill-evals program had the
burn-down authorization, then AFK authorization 2 ("supplements, not replaces"), then a standing
/goal that changed the default from "wait" to "go" for the plan of record except its "Mine alone"
list, renewed twice with a new end date each time. The Autonomy line lists all that are live.

**Succession.** A successor inherits no authority. Once its own chat has given it an authorization,
it may rely on the recorded approvals the maintainer names as inheritable; in the skill-evals
program that was exactly one kind, a ticket-wording approval already recorded on that ticket. A
recorded approval alone grants nothing.

**Across a compaction**, the authority log line plus the recorded copy is what you rely on. If the
log line is missing, you have no authority; ask.

## Hand-off and closing the pen

**Session length is the maintainer's call per program.** The skill-evals program ran both ways.
Session 2's rule was one PR per session ("a very long hub session is a false economy"); the
burn-down reversed it to "run as one hub for as long as you can" because the maintainer's biggest
risk that week was work stopping while nobody was there to start a new session. Short sessions
save tokens and context; a long-running hub covers absence. Hand-off is then the exception path
and the end-of-run path, not a routine.

**Forced means:** a crash or usage-limit death; the laptop sleeping; a reboot, editor or extension
update; a looping context; the maintainer's say-so (if they type `/handoff`, hand over now); expiry;
a permission prompt or refusal that blocks all remaining work with nobody there; `gh` auth expiring;
the machine out of memory.

**Before you go, four things, in this order:**

1. Clear any lock you hold on the root ticket.
2. Park the ticket you were on, on its own issue, **with what would unpark it**.
3. Run the `/handoff` skill in full mode (its doc lands on one machine; the root-ticket note is the
   record). Ignore the bootstrap prompt `/handoff` prints: a successor pastes the **program's**
   bootstrap prompt, which is written once on the root ticket and reused.
4. **Post one hand-off note on the root ticket**: every ticket you filed by number; the state of
   every draft PR and what it waits on; which tickets are parked and why; what each in-flight ticket
   has used of its tripwires; the path of your working folder and of the `/handoff` doc; the
   pre-flight's expected values for today; and that **the next session has no authority and is not
   the writer of the state block** until the maintainer gives it an authorization in its own chat
   and the sole-writer line names it. Also make the Current state block true.

**At the cut-off** (an authorization's expiry, or the program's freeze date): stop starting
tickets; park what remains with what would unpark it; make every unfinished must-have a filed
ticket that stands alone; put a closing comment on every open draft PR with its state, the SHA it
was verified at, and what the maintainer must check before shipping; leave a state someone can pick
up from the tickets alone, with no hub and no working notes.

**Closing the pen.** When the program closes, the hub's last edit sets the sole-writer line to
`none; a future hub claims the pen only on the maintainer's word in its chat`. The skill-evals
close-out (ticket #621, open at the time of writing) plans to scrub session names and ids from the
Current state block and the continuity note, so that the final record names roles, not windows.
That is why rule 2 requires a dated comment for every pen move: the body line is scrubbed, and
without the comments no trail of who held the pen survives. The skill-evals program did not post
those comments; its pen moves exist only in the Autonomy line's text.

## What went wrong, and what it cost

The pattern is recorded with its failures because each one bought a rule above.

- **Invented evidence.** 7 of 53 re-grade gradings made zero tool calls and invented their
  evidence, some while reaching the right verdict. Hence "accept no bare assertion without an
  artifact" and the void rule for zero-tool-call gradings.
- **The hub's own probes lied.** Shell probes run inline reported wrong state; the hub corrected
  its own statements to the maintainer at least six times. Hence "verify, do not trust" covers the
  hub, and probes run from a script file.
- **Stale peer names.** Session names changed on every window restart and the hand-off's adviser
  names were wrong by the time the successor read them. Hence "ask which window is which."
- **Idle advisers starved the machine.** At one forced hand-off, 28 idle agent processes held
  8.1 GB; the local e2e gate timed out and two tickets were parked on a red test with changes
  staged and uncommitted. Hence "keep advisers open only while needed" and "clear the lock, park
  the ticket, before you go."
- **Scheduled wake-ups were not durable.** Session-local timers died with the session and one
  evaluated cron fields in the wrong time zone. The root ticket plus a re-pasted bootstrap prompt is
  the only resume mechanism to rely on.
- **Over-long sessions.** One hub session (hub 3, 2026-09-19/20) reached about 730k tokens of
  context, with about 4M tokens of subagent work across about twenty launches and resumes. Its own
  verdict was that it should have handed off at an earlier named stop.
- **The maintainer's load was heavy.** Across the program the maintainer wrote about fifteen
  authorization, extension or renewal texts and typed around two dozen `/ship`s. Per hub
  registration: read the understanding page, answer about ten questions, write or paste the
  authorization, say GO, change the line, re-confirm after each window restart. Per ticket: sign
  the body, answer its numbered decisions, sign the texts, approve any skill or eval text, pick
  among parks, review and `/ship`, and do by hand the checks that cannot run unattended. Budget for
  three to five sign-offs per ticket plus the merge.
- **Scope was dropped, honestly.** The manual natural-language evals were dropped on 2026-09-23
  and recorded as dropped, not quietly omitted.

## When to use this, and when not to

**Use it when** work will span more than one agent session, more than one machine, or more than
one day; when several agents will touch the same ticket tree; or when a human must be able to
walk away and come back to a truthful state.

**Do not use it for** a single-session task, a one-PR fix, or anything a `/handoff` doc already
covers. The ceremony costs real tokens and real maintainer attention (see the cost figures above).
The pattern pays for itself only when the alternative is work stopping because the one person who
knew the state is not there.

## Worked example

Issue #507, "Skill-evals baseline: /skill-creator-centered testing for the team skills (program
tracker)." Use it as a pointer, not a template: its body shows the Current state block as it ended,
the Hub operating rules (subagent addendum, verification tiers, resume reconciliation, WAITING
lifecycle) and the HISTORICAL hub prompt. The hub 3 to burn-down hub hand-off comment (2026-09-21)
is the fullest statement of the registration procedure: section 9 "The pen", section 10 the working
folder, section 11 "Pre-flight", section 13 "Hand over only when forced", section 14 continuity
across a compaction. The burn-down authorization comment of the same day is the model for an
authority record; the /goal comment of 2026-09-26 is the model for a standing instruction. Ticket
#621 plans the pen's retirement.

Related: `docs/strategy-skill-evals.md` for the program this ran; `docs/strategy-project-management.md`
for the board conventions the tickets followed (new child tickets land in No Status; the hub triages
them); `.claude/skills/handoff/SKILL.md` for the single-session hand-off that this pattern wraps
(note that its step 6 says to paste the prompt it prints, which this pattern overrides);
`.claude/agents/phase-implementer.md` and `.claude/agents/specialist-max.md` for child and worker
agent definitions written to this contract.

## Peer-review record, 2026-10-29

Four `specialist-max` (Opus, xhigh) reviewers read the first pushed draft (commit `13af262`)
against #507's body and all 104 comments, tickets #617, #619 and #621, and the agent definitions.
Personas: the burn-down hub that held the pen; a child/deputy agent bound by the addendum; a cold
successor standing up a different program from the doc alone; the maintainer. None edited the doc.
Dispositions below; the reviewers' full reports are not in the repo.

**Applied (evidenced by the record or a repeatability gap):**

- Banner: the doc was drafted by an agent on Blake's behalf and is unreviewed by him. (maintainer)
- Authority: the full reserved list and never-do list; three authority states with attended mode
  after lapse; stacked grants; ticket-versus-note and rule-collision precedence; the authority log
  line and the compaction rule; drift classes; the channel, silence window and pulse clock;
  tripwires. (maintainer, hub, cold successor)
- Succession tightened: no inherited authority; recorded wording approvals usable only after the
  successor's own chat grants authority. (maintainer, hub)
- GO is held per session and needs merge rights. (maintainer)
- Pen moves: changed on the maintainer's word by them or a named hub; every move gets a dated
  root comment; the "trail survives in comments" claim corrected to say the program left none.
  (hub)
- Restart versus succession distinguished. (hub, cold successor)
- Hand-off rewritten to the record's four ordered steps, one note, "no authority / not the writer"
  sentence, ignore the prompt `/handoff` prints, reboot in the forced list, cut-off behaviour.
  (hub, maintainer, cold successor)
- Session-length trade-off stated instead of hard-coding "run long"; 730k figure re-attributed
  to one session with the 4M subagent figure and its lesson. (hub, maintainer)
- "What went wrong, and what it cost" section added, including the maintainer's load. (maintainer, hub)
- Child section: no-ship made absolute with "the addendum wins"; the addendum's coverage stated
  correctly and the text made a template with placeholders plus a refetch item; independence rules;
  work synchronously; relaunch rule; Worker row; `specialist-max.md` cited. (child, cold successor)
- Deputy row rewritten from #619 and #621 and marked as a late adaptation that stretches rule 2;
  workers return to the launching session. (child, hub)
- Approval block rule and the delegation-versus-approval packet distinction. (child, cold successor)
- "Starting a program" section; session name defined; working-folder layout; `Locks:`,
  `Binding comments:`, `Fast-follow:` and the running-log path added to the block; `Inheritor:`
  restored with its planned rename. (cold successor, hub)
- Pre-flight: Command column restored; row 4 no longer assumes `main`; row 10 counts only and
  files after GO; successor reads the log first; probes from a script file; predecessor folders
  read-only and their scripts never re-run. (cold successor, hub)
- Comment reading must page to the issue's full count; header line dated to 2026-09-21 with a
  placeholder; milestone-comment practice described as it changed. (all four)
- #621 described as planning, not showing, the retirement; scrub scoped to the block and the note.
  (hub, maintainer)

**Declined, with reasons:**

- Cut the Deputy row (cold successor). The deputy is real in #619 and #621; the reviewer could not
  see those tickets from #507 alone. Rewritten instead.
- Cut the inheritable wording-approval sentence as program-specific (cold successor). The hub and
  maintainer reviewers both confirmed it against the authorization; generalized to "the recorded
  approvals the maintainer names as inheritable."
- Add the doc to the AGENTS.md key-docs list (cold successor). Already done in `13af262`.
- Specify who triages child tickets on the project board (cold successor). One clause added to the
  pointer; the board conventions belong to `docs/strategy-project-management.md`.
- Edit `.claude/skills/handoff/SKILL.md` step 6 to match the record (cold successor). Out of this
  doc's scope; noted as an override in the pointer.
- Reproduce the maintainer's per-ticket sign-off list verbatim (maintainer). Condensed into the
  cost section; the full list is in the authorization record.

**Post-review change, 2026-10-30, on the maintainer's comment on the diff page:** rule 6 and the
authority states had restated the skills' own commit and PR checkpoints as a gate of this doc's
own. Checked against `.claude/skills/{commit,pr,ship}/SKILL.md`: the opt-out file skips only the
intent confirmation, the approval checkpoints always run, and the merge confirmation is the
checked-in `ask` rule. Rewritten so the doc defers to the skills as configured on each machine and
gates only the root ticket, its locks and paid launches.
