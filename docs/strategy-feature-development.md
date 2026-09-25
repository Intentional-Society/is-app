# IS Dev Team Feature Development Process

How a feature moves from idea to reality for the IS Web App.

A **quest** is a feature posted with a reward: a monetary thank-you for the
work. Each quest states a **base reward** that doubles as a prioritization
signal from the product budget; the final reward scales with the quality of the
work.

## Roles

- **Product Owner (PO):** James. Approves ideas and sets their base rewards,
  approves PRs, sets and pays final rewards.
- **Developer:** assignee on a GitHub issue; multiple can work on one as a
  team. Writes a spec if needed, implements a feature, and merges the PR.
- **Anyone** can add ideas, define them, and write specs.

## The pipeline

| Phase | Lives in | Board status | Enters when |
| --- | --- | --- | --- |
| 1. Ideation | **Ideas** tab of the Ideation doc | | Someone has an idea |
| 2. Definition | Its own tab in the Ideation doc | | Someone starts defining it |
| 3. Ready | GitHub issue + `docs/spec-<feature-name>.md` | Ready | It's a GitHub issue with reward |
| 4. Implementation | Branch + PR | In progress | There's enough spec to start building |
| 5. Acceptance and deployment | PR, then production | In progress, then Done on merge | A PR to `main` is open |
| 6. Reward | | Done; Reward status: Awaiting Payment, then Paid | Its PR is merged |

Quest issues carry the `quest` label. The public board's **Quests** and **Rewards**
views track them; see
[`strategy-project-management.md`](strategy-project-management.md#quests).

## 1. Ideation

Add brainstorms as bullets on the **Ideas** tab of the Ideation doc *(link
TODO)*. Half-formed is fine.

## 2. Definition

To define an idea, give it its own tab in the Ideation doc and fill in the
Definition template.

### Definition template

- **Name:** a single phrase.
- **What:** one sentence saying what the feature is.
- **Why:** one or two sentences on the goal, outcomes, and motivation.
- **How:** one to three paragraphs on how the feature works:
  - what users see, do, and experience (the UX flow)
  - anything important about how it's implemented
  - the data model, where relevant

The PO reviews and prioritizes definitions. An idea moves on when its
definition becomes a GitHub issue, usually created by the PO along with its base
reward. Anyone else can create the issue too; it waits in **No Status** until
the PO adds the reward.

## 3. Ready

An issue is ready to spec and implement when:

- It's defined well enough that someone can take it on and write its spec.
- A GitHub issue containing the definition sits in the board's **Ready** column.
- The PO has approved it, set its base reward, and labeled it `quest`.

To write the spec for a Ready issue, assign yourself. Write the spec at
`docs/spec-<feature-name>.md`, expanding the definition into a buildable
design, and link it from the issue. Then either go on to implement it, or
unassign yourself. Writing or improving a spec without implementing it is
valued work and earns a share of the reward.

## 4. Implementation

An issue is ready to implement when its spec is enough to start building.

A developer assigns themselves (if the spec's author isn't continuing) and
moves the issue to **In progress**. They build the feature on a branch
following [`strategy-branching.md`](strategy-branching.md) and
[`strategy-committing.md`](strategy-committing.md).

The spec is a working document, and you may improve it as you build. Asking
the PO for feedback on its design is recommended but not required.

## 5. Acceptance and deployment

A feature is done when:

- It does what its definition and spec describe.
- Its UX is high quality; see [`strategy-ui.md`](strategy-ui.md) and
  [`strategy-browser-support.md`](strategy-browser-support.md).
- Its code is high quality and maintainable; see `CLAUDE.md` and the docs it
  links.
- A PR to `main` is open.

The PO signs off by approving the PR. The developer then merges it once CI is
green, and `main` deploys to production automatically. Merging closes the
issue, which moves it to **Done**.

## 6. Reward

Once a quest's PR is merged, the PO sets the final reward by scaling the base
reward for the quality of the work. The PO records it in the issue's
**Reward ($USD)** field, replacing the base reward, and sets **Reward status**
to **Awaiting Payment**. When multiple people worked on a quest (say, a spec author
and a developer), the PO splits the reward by who did what. Contact the PO to
arrange payment; method, invoicing, and timing are handled case by case. Once
paid, the PO sets Reward status to **Paid**, or to **Declined** if no reward
will be paid.
