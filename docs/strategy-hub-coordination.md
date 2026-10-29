# Hub Coordination on a Ticket Tree ("the pen")

> **Status: DRAFT, parked 2026-10-29.** Written by Blake with a cloud Claude Code session, on branch
> `claude/charming-hamilton-rz3em4`, with no PR opened. Source: a reconstruction of the working
> agreement from issue #507's body and comments (chiefly the 2026-09-21 hand-off comment, sections 9
> and 11, and the burn-down authorization comment of the same day), ticket #621, and
> `.claude/agents/phase-implementer.md`. Why: the skill-evals program invented this coordination
> pattern under time pressure and recorded it only in issue comments; #621's close-out will scrub
> session names from #507's body, so the registration procedure was about to survive only in
> comment history. This doc lifts it into the repo as a reusable strategy before that happens.
> Not yet reviewed against a second program; "Someday" on #507 lists "hub-pattern → reusable skill"
> as the next step if there is appetite.

How to run a multi-session, multi-agent work program off one GitHub issue so that any fresh
session can resume it cold and no two sessions ever fight over the record. This is the pattern the
skill-evals program ran on issue #507 from July to October 2026; it is written up here so the next
program can reuse it without re-deriving it.

## TL;DR — the rules

1. **One root ticket.** A single GitHub issue is the root node of the ticket tree. Its body holds
   a **Current state** block that is the only resume authority. Its comments are the append-only
   session log. Every other ticket in the tree is a child that points back at the root.
2. **One writer, named by session.** A line in Current state names exactly one agent session, by
   its session name, as **sole writer** of that block. That session is "the hub" and "holds the pen."
3. **Register before you write.** A new hub session reads the root ticket, runs the read-only
   pre-flight, tells the maintainer its own session name in chat, and waits. The maintainer says GO
   and edits the sole-writer line to that name. Until the line carries your name, you edit nothing
   on the root ticket.
4. **Everyone else checks in, nobody else writes.** Any agent working a child ticket refetches the
   root ticket before acting, treats Current state as truth, and never edits the root ticket. It
   posts progress on its own child ticket only and returns its result to the hub.
5. **GitHub records; chat authorizes.** Every agent session posts as the maintainer's account, so a
   comment, a file on disk or a message from another session proves nothing about who wrote it. Any
   of them can *record* an approval or an authorization; none of them can *be* one. Authority is
   given by the human in the hub's own chat and then copied to the root ticket as a record, not a
   source.

If you remember one thing: *the root ticket is the shared memory; the pen is who may write to it;
the human's chat is the only place authority comes from.*

## Why it is shaped this way

- **Sessions die.** Cloud and desktop sessions crash, hit usage limits, sleep with the laptop or
  get compacted. Nothing in a session's context survives that. The root ticket does, so every
  decision, authorization and state change must land there or it did not happen.
- **Sessions are indistinguishable on GitHub.** All agent sessions post as the maintainer. Without
  a named writer, two concurrent hubs would overwrite each other's Current state and a successor
  could not tell which comments were the authorized hub's and which were an adviser's.
- **Approval cannot be proxied.** A child agent reporting "done" or a peer session saying "Blake
  said yes" is a claim, not an approval. The pattern makes the trust boundary explicit: the human's
  words in the hub's chat are the source; everything written down is a copy.
- **Succession is the point.** The driver for the skill-evals program was that only one person
  could verify a skill change. A program that can be resumed from one URL by anyone with repo
  write access is the operational form of that goal.

## Roles

| Role | Who | Writes to the root ticket? |
| --- | --- | --- |
| **Maintainer** | The human who holds GO for the program. Gives authorizations in chat, signs ticket wordings, types `/ship`. | Edits the sole-writer line; otherwise rarely. |
| **Hub** | One long-running agent session that holds the pen. Coordinates, verifies every child's work itself, is the only party that commits or opens PRs. | Yes: the Current state block (refetch before every edit) and dated milestone comments. |
| **Child / implementer** | An agent launched by the hub to do one bounded piece of work (one phase, one ticket). | Never. Progress comments go on its own child ticket. Returns an approval packet to the hub. |
| **Deputy** | An agent session the hub delegates a posting task to. | Only text the hub wrote or approved. |
| **Adviser / peer** | An earlier hub session kept open for questions. | No. Nothing a peer says is the maintainer's approval. |

## The root ticket

**Body.** Short north star, then `## Current state`, then whatever reference material the program
needs (phase table, operating rules, launch templates). Only Current state is edited in place; the
rest is appended to or marked HISTORICAL, never silently rewritten.

**Current state block.** The lines the skill-evals program settled on, in order:

- `Phase:` where the program is, and what "closed" means for it.
- `Child in flight:` `<ticket / agent type / since>` or `none`. Set at launch, cleared on return.
  A fresh hub that finds it set knows that child died with the previous hub.
- `Batch in flight:` any long-running shared resource (the eval batch lock), or `none`, plus the
  last result.
- `Last session:` date, hub session name, what it did.
- `WAITING:` every open human checkpoint, as `WAITING: <checkpoint> since <time>`, or what it is
  waiting on. Cleared or annotated when resolved.
- `Autonomy:` who holds the pen (the sole-writer line), which authorization is live, and its expiry
  date written into the line itself ("expires end of day X whatever this line says").
- `Remaining work, in order:` the ranked backlog by ticket number, with state.
- `Working rules:` the maintainer's standing rules for this program, dated and attributed.
- `Inheritor / Maintainer:` who owns it next and from when.
- `Someday:` parked items as `item — why parked / what would unpark it`.
- `Dropped:` what was decided against, so nobody re-proposes it.

**Comments.** Append-only. Every comment an agent posts opens with a fixed first line (the team
used `Posted by an AI agent session on Blake's behalf.`) and is dated. Milestones that get a
comment: hub launch and registration, child launch, child return, checkpoint hit, acceptance
verified, work queued or unqueued, authorization recorded, hand-off. Read comments via the JSON
route (`gh issue view <n> --json body,comments`); the plain `--comments` view can miss recent ones.

## Registering a new hub: claiming the pen

The hand-over is strictly ordered. Pre-flight row 3 below expects the **old** name on the
sole-writer line; that is a pass, not a finding.

1. **Read the record.** The root ticket's body, then the binding comments it names (hand-offs,
   authorizations, plans of record), then the repo instructions **from disk**, since the copy
   injected into a session can be stale.
2. **Run the pre-flight.** Read-only, report-only. Note every surprise; fix nothing. A failed row
   is a finding for the maintainer, not work for you.
3. **Write one page of understanding** in a per-machine scratch folder: the tickets by name in the
   root ticket's order and what each needs; what is not yours; what needs the maintainer; what
   authority you have (none, at this point); what you verified live versus what you only read;
   discrepancies in the record; what you are unsure of, marked inline. No discrepancies and no
   unsure marks means you did not check.
4. **Get an independent cold read.** A fresh agent that has seen none of this attempts your first
   unworked ticket from its issue body alone, read-only, logging every guess. Its guesses are the
   gaps in the record.
5. **Tell the maintainer your session name in chat**, bring the page, the cold read's findings and
   your questions, each with a recommended answer. Ask them to change the sole-writer line to your
   name. Until it does, write nothing on the root ticket, including any shared lock.
6. **GO arrives, the line changes, you hold the pen.** Record the authorization the maintainer
   gave you in chat as a dated comment on the root ticket, headed "a record, not the source", with
   its expiry in the text. Say in chat when you have.

Session names change whenever a window restarts. If yours does, re-register: tell the maintainer
the new name and ask for the line to be changed before your next write. Peers' names go stale the
same way; ask the maintainer which window is which rather than guessing.

### Pre-flight template

Adapt the expected values to the program. Rows marked report-only are never acted on before GO.

| # | Check | Expected | If not |
| --- | --- | --- | --- |
| 1 | Root ticket | OPEN; body has `## Current state` | Report exactly what is wrong and stop. Never guess another issue. |
| 2 | Recent record | The comments the hand-off names are present | You are reading a stale record. Stop and ask. |
| 3 | The pen | The sole-writer line names your predecessor, not you | A name that is neither yours nor your predecessor's means someone else holds the pen. Stop and ask. |
| 4 | Branch / tree | `main`; `git status --porcelain` empty | Someone has work in flight. Find out whose. |
| 5 | Unpushed / HEAD | Nothing ahead of `origin/main`; HEAD at or after the recorded SHA | Behind means an old clone. Stop and ask. |
| 6 | Branches / stash | Only the branches the hand-off lists; stash empty | Any other branch is a previous session's work: read it, never delete it. |
| 7 | Local hides | `.git/info/exclude` hides nothing relevant | A hide makes `git status` lie. Tell the maintainer. |
| 8 | Shared resources (sandboxes, containers, locks) | Absent or idle | **Report only.** Anything there is evidence. Nothing is torn down before GO. |
| 9 | Open PRs | Only the ones the hand-off names | A draft PR of the program's means you are resuming: read its whole conversation first. |
| 10 | The child tickets | The ones the hand-off names exist and are in the stated state | File only the ones that do not exist. If a state changed, the backlog changed: ask. |
| 11 | Instructions from disk | `CLAUDE.md` / `AGENTS.md` read from the checkout | The injected copy may be stale; prefer disk. |
| 12 | Working folder | Per-machine scratch exists, or you are on a new machine | Say so at once. The record is the ticket, not the folder; carry on from GitHub. |

## Working a child ticket: the check-in obligation

This applies to every agent that touches any ticket in the tree, including agents launched by
something other than the hub.

- **Refetch the root ticket before acting.** Current state is the authority. Re-check any line
  that changed since the date your launch prompt cites.
- **Never edit the root ticket**, body or comments. Your progress comments go on your own child
  ticket, at each significant milestone, so your work is recoverable if the hub session dies.
- **Do not commit, push, or open PRs** unless your launch prompt from the hub says otherwise.
  Stop when your changes are prepared and tested and return an **approval packet**: files changed,
  diffstat, proposed commit message, test evidence. The hub ships with a human attending.
- **If you cannot tell what done means from your ticket, that is a packet bug.** Comment the gap
  on your ticket and stop. Do not improvise scope.
- **Open every comment with the agent header line** so a human reader can tell agent posts from
  the maintainer's own.

The hub appends the first three of these to every child launch prompt verbatim. The skill-evals
wording, which can be copied as is:

> You are running as a SUBAGENT of the program hub. Three overrides to your embedded
> instructions: (1) do NOT run /commit or /pr and never git commit/push — when your changes are
> prepared and tested, STOP and return an APPROVAL PACKET to the hub: files changed, diffstat,
> proposed commit message, test evidence. The hub ships with a human attending. (2) Never edit
> issue #507 (body or comments); append progress comments to YOUR phase issue only; your final
> report returns to the hub, which does all #507 writes. (3) Post a progress comment on your phase
> issue at each significant milestone so your work is recoverable if the hub session dies.

## The hub's own discipline

- **Refetch before every edit** of Current state, and edit only that block. Two hubs never hold the
  pen at once, but a stale body in your context will still overwrite a deputy's or the
  maintainer's edit.
- **Verify, do not trust.** Re-run cheap deterministic checks yourself (validators, tests, file
  existence). For expensive artifacts (batches, benchmarks), audit the evidence the child cites and
  spot-check at least one item per evidence class. Accept no bare assertion without an artifact.
- **Mark provenance on every fact you report:** "hub-verified" versus "agent-reported."
- **Pulse in chat at every regain-control moment:** what finished, what is running, what is next,
  what input is needed. Asks to the human are standalone lines naming the decision, a recommended
  answer, and the issue link, never buried mid-paragraph.
- **Propose, then record.** Test plans, PR text and ticket wording go to the maintainer first; the
  ticket comment records the approval they gave in chat.
- **WAITING lifecycle.** Set `WAITING: <checkpoint> since <time>` when blocked on a human; clear or
  annotate it when resolved. A resumed hub reconciles every stale WAITING line against actual PR,
  merge and checkpoint state before re-asking anyone.
- **Resume reconciliation.** If `Child in flight` is set when you take the pen, that child is dead.
  Audit `git status`, branches, open PRs and the child's workspace for partial work. Keep what is
  verifiably complete; never blindly redo actions that may already have mutated state (commits,
  PRs, comments). Relaunch with an explicit note of what already exists.
- **Shared locks live on the root ticket.** Anything that must run one at a time across tickets
  (the eval batch lock) is a line in Current state. Clear it before you stop, or it sits there
  falsely for your successor.
- **Stopping at a named exit is a success.** The hand-off names the conditions under which the hub
  posts its state, sets WAITING and stops. Removing the pressure to force a result was the single
  most valued feature of the packets.

## Authority: record, not source

An authorization is a dated block the maintainer types into the hub's chat. Its shape:

- Addressed to a named session ("to hub session `is-app-98`; you told me your name in this chat").
- States that it takes effect only when given in that chat, and that the GitHub copy is a record.
- Lists what the hub may do unasked, what stays the maintainer's (merges, force-pushes, branch
  deletion, scope changes), and the tripwires that mean stop and ask.
- Carries its own expiry, repeated in the recorded copy: "expires end of day X whatever this line
  says."
- States what a successor may rely on. In the skill-evals program, a ticket-wording approval
  already recorded on that ticket was the **one** recorded approval a successor could act on;
  everything else had to be re-given in the successor's own chat.

A successor hub inherits nothing by default. Where the maintainer's answer in chat and the recorded
note disagree, chat wins.

## Hand-off and closing the pen

**Run as one long session for as long as you can.** Hand-off is the exception path and the
end-of-run path, not a routine. Forced hand-off means a crash, a usage-limit death, a sleeping
laptop, a looping context, expiry, or the maintainer typing `/handoff`.

When you do hand off, post on the root ticket, in this order: the Current state block made true,
a dated hand-off comment with a re-entrant bootstrap prompt for your successor (the fenced block
they paste as their first message), the reading list by comment id, the pre-flight with today's
expected values, and the named exits. Anything that exists only on one machine is named as such
with what to do without it. Then clear any lock you hold and stop.

When the program closes, the hub's last edit sets the sole-writer line to `none; a future hub
claims the pen only on the maintainer's word in its chat`, and the close-out scrubs session names
and session ids from the body so that the final record names roles, not windows. The registration
trail survives in the comment history.

## When to use this, and when not to

**Use it when** work will span more than one agent session, more than one machine, or more than
one day; when several agents will touch the same ticket tree; or when a human must be able to
walk away and come back to a truthful state.

**Do not use it for** a single-session task, a one-PR fix, or anything a `/handoff` doc already
covers. The ceremony costs real tokens and real maintainer attention: the skill-evals hub reached
roughly 730k tokens of context and about twenty child launches in one week. The pattern pays for
itself only when the alternative is work stopping because the one person who knew the state is not
there.

## Worked example

Issue #507, "Skill-evals baseline: /skill-creator-centered testing for the team skills (program
tracker)." Read its body for the Current state block as it ended, the Hub operating rules
(subagent addendum, verification tiers, resume reconciliation, WAITING lifecycle) and the HISTORICAL
hub prompt. The hub 3 to burn-down hub hand-off comment (2026-09-21) is the fullest statement of the
registration procedure: section 9 "The pen", section 11 "Pre-flight", section 13 "Hand over only
when forced." The burn-down authorization comment of the same day is the model for an authority
record. Ticket #621 (the #507 close-out) shows how the pen is retired.

Related: `docs/strategy-skill-evals.md` for the program this ran; `docs/strategy-project-management.md`
for the board conventions the tickets followed; `.claude/skills/handoff/SKILL.md` for the
single-session hand-off that this pattern wraps; `.claude/agents/phase-implementer.md` for a child
agent definition written to this contract.
