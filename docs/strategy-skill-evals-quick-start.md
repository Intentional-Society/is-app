# Skill Evals Quick Start

A one-page entry point to the skill docs, for anyone creating, changing or testing a Claude Code skill in this repo. It links to the docs and does not repeat them.

## Who this is for

Anyone, human or AI agent, who is new to this repo's Claude Code skills. A **skill** is a folder under `.claude/skills/` that holds a written procedure Claude Code follows, such as `/commit`, `/pr` or `/ship`. An **eval** is a scripted test prompt for one skill, stored in that skill's `evals/evals.json`. A **routing eval** checks that the right skill fires from plain words; an **execution eval** runs the skill inside a sandbox and checks what it did. The **harness** is the test code under `scripts/skill-evals/` that runs evals safely. A **sandbox** is a throwaway git repo with a fake `gh` (the GitHub command-line tool), called the **stub**. Nothing done inside a sandbox reaches GitHub.

## The safety rule, word for word from CLAUDE.md

> Skill-eval prompts (`.claude/skills/{commit,pr,ship}/evals/evals.json`) are never executed against the real repo or real GitHub — any skill, any origin. Execution happens only inside a harness-built sandbox (`scripts/skill-evals/`, via `make-sandbox --fixture <name>`)

**The testing rule**, from [Strategy doc section 6](strategy-skill-evals.md#6-running-evals--the-one-testing-rule): when you change a skill or one of its evals, run the full pass ([Running the evals](#running-the-evals), below) before the pull request. A person starts it; CI never does. A change that touches only routing evals does not owe it; section 6 says what it owes instead.

## The life of a skill

Every skill task, new or existing, starts by invoking `/skill-creator`, the repo's front door for creating, changing and testing a skill ([Strategy doc section 2, "Lifecycle map"](strategy-skill-evals.md#2-lifecycle-map)). The steps, in section 2's order:

1. Intake. `/skill-creator` asks what the skill is for. In this repo it also asks the safety-triage question: does the skill change git or GitHub state? A skill that does needs execution evals run in sandboxes; one that does not needs only routing evals.
2. Draft `SKILL.md`, the skill's written procedure.
3. Write its evals in `evals/evals.json`: routing evals for every skill, and execution evals with a **fixture** (a named starting state) for a skill that changes git or GitHub state ([Strategy doc section 3, "Adding a new eval"](strategy-skill-evals.md#adding-a-new-eval)).
4. Run the evals twice, with the skill and without it (the baseline), execution evals inside sandboxes. The **grader**, a separate AI agent, scores both runs ([Running the evals](#running-the-evals), below).
5. Review the results. A REAL-MISS is a bug in the skill, the eval or the harness ([How to read a result](#how-to-read-a-result), below).
6. Tune the skill's **description**, the sentence Claude Code reads to decide when the skill applies, until the right skill fires from plain words ([Strategy doc section 8, "Platform routing"](strategy-skill-evals.md#8-platform-routing-layer-c)).
7. Ship through `/commit` and `/pr`, with a maintainer's sign-off on the `SKILL.md` and on the evals' expectations ([Who may change eval or skill text](#who-may-change-eval-or-skill-text), below).

Afterwards, any change to a skill's `SKILL.md` or to one of its evals means a full pass before the pull request (the testing rule above; [Strategy doc section 8, "Landing a description change"](strategy-skill-evals.md#landing-a-description-change); [section 11, "Maintenance rules"](strategy-skill-evals.md#11-maintenance-rules)). Worked examples for a new skill, a changed skill and a teammate arriving cold: [Design doc, Scenario A](design-skill-evals-harness.md#scenario-a--create-a-brand-new-skill), [Scenario B](design-skill-evals-harness.md#scenario-b--update-an-existing-skill-and-re-run-its-evals), [Scenario C](design-skill-evals-harness.md#scenario-c--a-teammate-verifies-a-skill-by-natural-language).

## Who may change eval or skill text

Anyone may propose a change in a pull request. A change to a skill's `SKILL.md` needs a maintainer's sign-off ([Strategy doc section 8, "Landing a description change"](strategy-skill-evals.md#landing-a-description-change)). So does a new or changed eval's list of expectations (see "Sign-off" in [Strategy doc section 3, "Adding a new eval"](strategy-skill-evals.md#adding-a-new-eval)). A maintainer is a team member with write access to the repo. Nobody hand-edits the vendored copy of Anthropic's skill-creator under `.claude/skills/skill-creator/` ([Strategy doc section 11](strategy-skill-evals.md#11-maintenance-rules)).

## Which doc for which task

| I want to... | Go to |
|---|---|
| create a new skill and its first evals | [The life of a skill](#the-life-of-a-skill), above |
| add an eval to a skill, for example `/pr` | [Strategy doc section 3, "Adding a new eval"](strategy-skill-evals.md#adding-a-new-eval) |
| change a skill's `SKILL.md` or description | [Strategy doc section 8, "Landing a description change"](strategy-skill-evals.md#landing-a-description-change) |
| run a full execution batch | [Running the evals](#running-the-evals), below |
| explain a REAL-MISS in a batch report | [Strategy doc section 6, "Miss labels"](strategy-skill-evals.md#miss-labels) |
| anything else | The strategy doc's own table, ["Which doc do I want?"](strategy-skill-evals.md#which-doc-do-i-want) |

## Running the evals

There are two kinds of runs. While you build a skill (step 4 above), you run one eval at a time by hand; that is for authoring only. Before a pull request that changes a skill or its evals, a person starts a **full pass**; that is the testing rule above. A full pass has four phases, each described in [Strategy doc section 6](strategy-skill-evals.md#6-running-evals--the-one-testing-rule): the **selfcheck**, which proves the sandbox rig is safe; the **routing runner**, which checks that plain words fire the right skill; the **execution batch**, which runs every execution eval of every skill, each in its own sandbox, and is the only phase that raises approval prompts; and the **manual natural-language evals**, which a person types.

An AI agent given the batch prompt usually drives the execution batch: [`scripts/skill-evals/prompts/batch-prompt.md`](../scripts/skill-evals/prompts/batch-prompt.md). The exact commands, for PowerShell and bash, are in [Strategy doc section 6, "Running it"](strategy-skill-evals.md#running-it--the-exact-commands-powershell-and-bash). The sandbox steps below apply to any execution-eval run, one eval while authoring or the whole batch. Steps 1 to 5 follow the strategy doc's order; step 6 is the repo's rule for local Docker containers, from CLAUDE.md:

1. Build a sandbox from the eval's fixture (its named starting state), then activate it so `gh` points at the stub.
2. Run the selfcheck, which proves the sandbox is safe to use.
3. Run the eval inside the sandbox.
4. Archive the evidence: the stub's log of `gh` calls, the git state and the stub's state. The grader, a separate AI agent, scores the run from these files.
5. Tear the sandbox down.
6. At the end, run `npm run dev:db:stop` to stop the local database containers, which otherwise keep running.

## What you will be asked to approve

During a full execution batch a human is asked to approve sandbox `gh pr merge` prompts. They reach only the stub. The batch waits until someone approves them. See ["What you will be asked to approve"](strategy-skill-evals.md#what-you-will-be-asked-to-approve) and the run briefing example in [#599](https://github.com/Intentional-Society/is-app/issues/599).

## How to read a result

Each eval has **expectations**: written checks the grader marks PASS or FAIL ([Strategy doc section 3, "Eval object fields"](strategy-skill-evals.md#eval-object-fields)). In an execution batch, every FAIL gets one **miss label** that says why it failed:

- [ENVIRONMENT](strategy-skill-evals.md#miss-labels): a sandbox command was refused by Claude Code's permissions or its auto-mode classifier, not by the skill.
- [KNOWN-DEFECT](strategy-skill-evals.md#miss-labels): a defect already recorded in the eval text or the fixture, with its ticket cited.
- [REAL-MISS](strategy-skill-evals.md#miss-labels): anything else. This is the one to investigate.
- [VOID](strategy-skill-evals.md#6-running-evals--the-one-testing-rule) is not a miss label. It marks a **routing run** (one run of a routing eval) whose grading is left out of the routing runner's average. That happens when the grader answered without opening a file. It is defined in the example briefing text in section 6.

## Never run

These look like instructions but belong to the finished program that built the harness. Read them for history only; never follow them:

- [`docs/old-archive/spec-skill-evals-baseline.md`](old-archive/spec-skill-evals-baseline.md)
- [`docs/old-archive/spec-skill-evals-outline.md`](old-archive/spec-skill-evals-outline.md)
- The long instruction texts posted as comments on [#507](https://github.com/Intentional-Society/is-app/issues/507) while the program ran, and the one in its body.
