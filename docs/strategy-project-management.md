# Project Management Strategy

## Current approach: single GitHub Projects board

All work lives on the [`is-app dev`](https://github.com/orgs/Intentional-Society/projects/2) GitHub Project. Issues in the `is-app` repo are auto-added to the board via the built-in "auto-add from repository" workflow.

One board, one source of truth. We're small enough that splitting work across multiple projects, milestones, or external trackers would cost more than it saves.

## Statuses

Five statuses, in flow order:

1. **No Status** — unvetted. Auto-added issues land here. Nobody has committed to doing these; they're candidates. Either promote to Backlog or close.
2. **Backlog** — "we've decided to do this, just not yet." Prioritized, but not queued for the current cycle. Should stay scannable — if it grows past a few dozen items, prune rather than let it become a graveyard.
3. **Ready** — next up. Has enough context that someone could pick it up and start. Small queue by design.
4. **In progress** — actively being worked on. Usually has an assignee and a branch.
5. **Done** — merged / shipped / closed.

The split between No Status and Backlog is deliberate: Backlog is supposed to mean something. If every idea and drive-by report went straight into Backlog, it would stop being a plan.

To move an item back to No Status, click its current Status chip and toggle it off — the UI hides this behind the same control that sets a status.

## Views

Two main views:

- **All items** (table) — full list, sortable, bulk-edit friendly. The default working view.
- **Kanban** (board) — kanban columns by Status. Useful for seeing what's moving and what's stuck.

(We deleted the default Priority and Roadmap views. Priority will come back if/when we start using the Priority field seriously. Roadmap needs Start/Target dates per item, which only matters if we're scheduling releases.)

## Automations

Project page → **Workflows** (top right area).

Enabled:

- **Auto-add** — new issues (and sub-issues) in `is-app` repo are added to the board automatically.
- **Item closed → Done** — closing an issue also sets status to done.
- **Item Done → issue closed** — setting status to done also closes the issue.
- **PR Linked → In progress** - When a pull request is linked to an issue, the issue gets status "In progress"
- **PR Merged → Done** - When a pull request is merged to main, the issue gets status "Done"

Deliberately disabled:

- **Item added to project** (default: set Status = Backlog) — turned off so newly added items land in No Status instead. This preserves the triage step: Backlog should mean "we've decided to do this," which requires a human look.

The rest of GitHub's built-in automations are off.

## Issue conventions

> TODO: document title format, labels we actually use, when to file an issue vs just ship it, how to link PRs to issues, how we use assignees.

> TODO: document how we triage No Status — who does it, how often, what "promote to Backlog" requires.

## When to reconsider

- **Backlog past ~50 items and nobody's reading it** — prune, or split into themed sub-lists, or accept that the bottom of the list is effectively "No Status" and rename accordingly.
- **Multiple people working in parallel on overlapping areas** — might need assignees, might need a WIP-limit column, might need a second board per workstream.
- **External contributors start filing issues** — will need labels (bug/feature/question) and a triage cadence.
