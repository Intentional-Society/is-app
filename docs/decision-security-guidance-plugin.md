# Decision: Adopting Anthropic's Claude Code security-guidance plugin

**Status:** Proposed — awaiting review
**Author:** Claude (drafted via Claude Code on the web), for the dev team
**Reviewer:** @james-baker
**Date:** 2026-06-29 (supersedes a 2026-05-30 draft that was never merged)
**Decision type:** Tooling / developer-workflow / defense-in-depth

> This is a decision doc, not a how-to. It studies our actual repo, weighs the
> plugin against what we already run, and ends with a recommendation and a
> rollout plan. Anything that depends on a fact I could not confirm from the
> repo is marked **TODO** in **bold** — please resolve those before we commit
> to a path.

---

## 1. Problem statement

We want to know **whether and how** to adopt Anthropic's Claude Code
[security-guidance plugin](https://code.claude.com/docs/en/security-guidance)
across the team. The plugin makes Claude review its own diffs for common
vulnerabilities *in the session that wrote them* and fix what it finds before
the code reaches a PR. We already run a layered review stack (CodeQL, a PR-time
Claude Code Review, CI, Dependabot, a supply-chain quarantine). The questions
are:

1. Does the plugin fill a **genuine gap**, or is it **redundant** with what we
   already pay for?
2. How does it interact with the **PR #133 procedure framework** (`/commit`,
   `/pr`, `/ship`) — does it belong *inside* those Skills, or is it orthogonal?
3. Our team spans **Windows and Mac**, and the plugin behaves differently per
   OS. How much does that matter?
4. What's the least-friction way to roll it out, and what does it cost?

## 2. Scope

**In scope:** enablement strategy (user / checked-in / org-managed), the
plugin's three review layers vs. our existing stack, interaction with the
Skills, the Windows/Mac split, custom rule files (`claude-security-guidance.md`,
`security-patterns.*`), and a rollout/validation plan.

**Out of scope:** replacing CodeQL or the PR-time Code Review (the plugin is
explicitly a *complement*, not a replacement — see §4); a full security audit of
the app; changing our CSP or header strategy (`docs/strategy-security.md`
already owns that).

## 3. Assumptions

- Plugin facts below were captured from
  <https://code.claude.com/docs/en/security-guidance> on 2026-05-30 and
  **re-verified unchanged on 2026-06-29**; they should be re-checked again at
  adoption time, since Anthropic ships plugin changes continuously.
- We continue trunk-based development: feature branches PR into `main`, which
  auto-deploys (`CLAUDE.md` › Workflow).
- The team uses Claude Code both **locally** and via **Claude Code on the web /
  cloud sessions** (this doc was drafted in one). **TODO(team):** confirm how
  often cloud sessions are actually used — it changes the weight of the
  "user-scope doesn't carry to the web" limitation in §6.
- **Effectively all authored code flows through Claude Code.** Other agents
  appear occasionally (e.g. PR #476 was co-authored by GPT-5 Codex), but per the
  team this is rare, so the plugin's Claude-Code-only scope is not a practical
  coverage gap today (revisit only if non-Claude-Code agents become common —
  see §6 footnote).
- We keep the PR #133 Skills as the canonical check-in path
  (`.claude/skills/{commit,pr,ship}/SKILL.md`).

---

## 4. What the plugin actually is (verified facts)

Source: <https://code.claude.com/docs/en/security-guidance> (captured 2026-05-30,
re-verified 2026-06-29 — no changes).

**Install / prereqs.** `/plugin install security-guidance@claude-plugins-official`
then `/reload-plugins`. Free on all plans. Requires **Claude Code ≥ 2.1.144**
and **Python 3.8+** on `PATH` (tries `python3`, `python`, `py -3`). On first run
it builds a venv under `~/.claude/security/` and `pip`-installs the Claude Agent
SDK (needs network).

**Three review layers, increasing depth:**

| Layer | Trigger (hook) | Cost | What it catches |
|---|---|---|---|
| 1. Per-edit pattern match | `PostToolUse` on Edit/Write/NotebookEdit | **None** (deterministic string match, no model call) | `eval(`, `new Function`, `os.system`, `child_process.exec`, `pickle`, `dangerouslySetInnerHTML`, `.innerHTML =`, `document.write`, and edits under `.github/workflows/` |
| 2. End-of-turn diff review | `Stop` (background) | Model usage per turn that changed files | Authz bypass, IDOR, injection, SSRF, weak crypto — things a string match can't see. Up to 30 changed files/turn; fires ≤3× in a row |
| 3. Agentic commit/push review | `PostToolUse` on `Bash` filtered to `git commit` / `git push` | Model usage, multi-turn | Deeper read of callers/sanitizers/related files to suppress false positives. **Only fires on commits/pushes Claude makes through its Bash tool** — not `!` shell-escape, not commits you run in your own shell. Capped at 20/rolling hour |

**Independence:** reviews run as a *separate* Claude call with fresh context and
a security-focused prompt — not the same instance grading itself. Layer 1 has no
model at all.

**Not a gate.** No layer blocks a write or commit. Findings reach the writing
Claude as instructions; it addresses them in-conversation. The doc is explicit:
"Treat the plugin as one layer of defense in depth, not a complete security
solution."

**Default model:** both model-backed layers use **Claude Opus 4.7** by default;
overridable via `SECURITY_REVIEW_MODEL` (layer 2) and `SG_AGENTIC_MODEL`
(layer 3). Individual layers can be disabled with `ENABLE_PATTERN_RULES=0`,
`ENABLE_STOP_REVIEW=0`, `ENABLE_COMMIT_REVIEW=0`, all model layers at once with
`ENABLE_CODE_SECURITY_REVIEW=0`, or the whole plugin with
`SECURITY_GUIDANCE_DISABLE=1`.

**Extensibility (additive only — can't suppress built-ins):**
- `.claude/claude-security-guidance.md` — plain-language threat model / checklist
  loaded into the model-backed reviews (8 KB combined cap across user/project/local
  locations).
- `.claude/security-patterns.yaml|.yml|.json` — custom deterministic per-edit
  rules (regex/substring, optional path globs). **JSON works on any Python
  install; the YAML forms require PyYAML to be importable, which the plugin does
  not install for you.** Up to 50 rules.

**Windows behavior (load-bearing for us — see §7):** Windows **skips the venv
step**, so the layer-3 agentic commit review runs only if `claude-agent-sdk` is
already importable, and otherwise **falls back to a single-shot review**.
Layers 1 and 2 are unaffected.

**Enablement scopes:**
- **User scope** — per machine; **does not carry to Claude Code on the web**
  (cloud sessions run on Anthropic infra).
- **Checked-in `.claude/settings.json` `enabledPlugins`** — covers cloud
  sessions and everyone who clones.
- **Org managed settings** — admin-enforced org-wide; only an admin can disable.

---

## 5. What we already run (the existing stack, with citations)

Our review/defense surface today:

| Stage | Mechanism | File | Notes |
|---|---|---|---|
| In CI (every PR) | **CodeQL** `javascript-typescript` **and** `actions`, `security-extended` queries | `.github/workflows/codeql.yml` | Also on push to `main` + weekly; SARIF suppression-marker dismissal gated to `main` |
| On every PR | **Claude Code Review** (multi-agent) via `claude-code-action` + `code-review@claude-code-plugins` | `.github/workflows/claude-code-review.yml` | This is the plugin's own stated downstream companion |
| On `@claude` mention | Claude Code bot (can push commits/PRs) | `.github/workflows/claude.yml` | Ephemeral GH-hosted runner |
| In CI (every PR) | Biome + `typecheck` + `migrate` + functional tests | `.github/workflows/ci.yml` | Docs-only PRs skip via `dorny/paths-filter` but still report green |
| Post-deploy | Playwright E2E | `.github/workflows/e2e.yml` | Fires on Vercel `deployment_status` |
| Dependencies | **Dependabot** (npm + actions) with `cooldown` mirroring the npm quarantine | `.github/dependabot.yml` | |
| Supply chain | `min-release-age=3` quarantine | `.npmrc`; `docs/strategy-security.md` §Supply-chain quarantine | Dependabot `cooldown.default-days: 3` kept in sync |
| Secrets | GitHub **secret scanning + push protection** enabled | repo settings; `docs/plan-security-hardening.md` | Overlaps the plugin's layer-1 hardcoded-key flag — but acts at push, not authoring |
| Workflow tamper-gate | CODEOWNERS review required on `.github/workflows/` and `CODEOWNERS` | `.github/CODEOWNERS` | "so a tampered workflow can't land without an explicit review" (item 6, `docs/plan-security-hardening.md`) |
| Runtime hardening | Full security-header / CSP suite + threat model | `next.config.ts`; `docs/strategy-security.md` |
| Local pre-commit | lefthook → Biome auto-fix on staged files | `lefthook.yml`; `scripts/biome-precommit.mjs` | |
| Check-in procedure | `/commit`, `/pr`, `/ship` Skills (PR #133) | `.claude/skills/{commit,pr,ship}/SKILL.md` | `/commit` and `/pr` now NL-invokable; `/ship` still `disable-model-invocation: true` |

Our **threat model** (`docs/strategy-security.md` §"Threat model in one
paragraph") names the realistic risks: **(1) XSS via dependency compromise or a
careless `dangerouslySetInnerHTML`**, (2) clickjacking, (3) `Referer` leakage,
(4) network downgrades. It explicitly notes that because the CSP keeps
`script-src 'unsafe-inline'` (Next App Router emits unstable inline hydration
scripts), **CSP cannot block an injected `<script>` — so XSS in our own HTML is
not header-defended.** That makes catching a stray `dangerouslySetInnerHTML`
*at authoring time* genuinely valuable, not theoretical.

**Relevant precedent (read this before deciding):** the team already evaluated
and **rejected a per-edit Claude Code hook** on performance grounds —
`docs/devjournal.md` (2026-05-29, Blake): *"Considered a per-edit Claude Code
hook but dropped it — npx overhead was ~1.1s per Edit/Write."* The plugin's
layer 1 is exactly this class of thing (a `PostToolUse` hook), so per-edit
latency is a known sensitivity for this team and must be measured, not assumed
(see §9 validation plan). Note the plugin's layer 1 is a Python string match,
not an `npx` spawn, so its per-edit cost profile may differ — but it is still a
hook firing after every edit.

---

## 6. Fit assessment: redundancy vs. genuine gap-filling

Defense-in-depth only earns its keep where each layer catches what the others
miss. Here's where the plugin overlaps vs. fills a gap.

### Layer 1 (per-edit pattern match) — *mostly net-new, near-zero cost*
- **Overlap:** CodeQL `security-extended` already flags DOM-injection sinks
  (`dangerouslySetInnerHTML`, `document.write`) and the `actions` pack already
  scans workflow YAML. So the *findings* are partly redundant with CodeQL.
- **Gap it fills:** CodeQL runs **at PR time**; layer 1 runs **as the line is
  written**, at **zero model cost**, and **in cloud sessions where CodeQL hasn't
  run yet**. For a repo whose #1 named risk is XSS-via-`dangerouslySetInnerHTML`
  (`docs/strategy-security.md`), an instant in-editor nudge is the cheapest
  possible reinforcement. Its workflow-file flag also complements the CODEOWNERS
  tamper-gate (`.github/CODEOWNERS`) by warning the *author* before the gate
  ever triggers.
- **Verdict:** keep. Free, and it shifts our top risk left.

### Layer 2 (end-of-turn diff review) — *real overlap with PR Code Review, but earlier*
- **Overlap:** this is the **most redundant** layer. It's a model-backed
  security/correctness pass on the diff — which is essentially what
  `claude-code-review.yml` already does at PR time, and what `/security-review`
  does on demand. Same class of findings (authz, IDOR, injection, SSRF).
- **Gap it fills:** it runs **in-session, before the PR exists**, so issues get
  fixed without a PR round-trip and reviewer attention. The official doc frames
  the plugin precisely as "reducing what reaches the PR." For us that means
  fewer Code-Review comments and less of James's review time spent on
  mechanical findings.
- **Cost/caveat:** it spends Opus 4.7 usage on **every turn that changes files**
  (capped: ≤30 files, ≤3× in a row). On a heavy editing session that is a
  non-trivial, recurring spend on top of the CI Code Review we already pay for.
- **Verdict:** valuable but the main cost driver. Consider downgrading its model
  (`SECURITY_REVIEW_MODEL`) to Sonnet/Haiku to cut spend, or gating it behind
  the pilot's cost data.

### Layer 3 (agentic commit/push review) — *deepest, most expensive, OS-sensitive*
- **Overlap:** overlaps with both CodeQL and PR Code Review.
- **Gap it fills:** the agentic context-read keeps false positives low, and it
  fires **on the commits our `/commit` Skill makes through Bash** (`/commit`
  runs `git commit` via the agent's Bash tool), so it lands right where our
  check-in flow already is.
- **Caveats:** (a) capped 20/rolling hour; (b) **degrades on Windows** (§7);
  (c) **does not** review commits a human makes from their own shell or via `!`
  escape — only Claude's Bash commits.
- **Verdict:** highest cost, most OS-variance. Treat as opt-in / measure-first.

### Where the *genuine, un-redundant* value is: the custom rule files
The biggest differentiated win is **encoding our specific threat model** into
files CodeQL's generic queries don't know about:

- `.claude/claude-security-guidance.md` could state, in plain language drawn
  straight from `docs/strategy-security.md`:
  - No `dangerouslySetInnerHTML` (our CSP can't block injected scripts).
  - Browser code must reach Postgres **only through Hono** — the Supabase Data
    API is disabled and DB queries must not go direct from the browser
    (`docs/strategy-security.md` §`connect-src`).
  - Don't add to CSP `connect-src` speculatively (the "one-way ratchet" rule).
  - Don't log member PII.
- `.claude/security-patterns.json` (JSON, **not** YAML — we can't assume PyYAML
  is importable on every machine, and the docs say JSON works on any Python
  install) could deterministically flag: hardcoded Supabase keys, edits to the
  CSP block in `next.config.ts`, or direct browser→Supabase data calls.

This is coverage **CodeQL and the generic Code Review do not provide**, because
it's our policy, not a language rule. **This is the strongest argument for
adopting the plugin at all.**

> **Footnote — the multi-agent angle (deliberately not load-bearing).** The
> plugin is Claude-Code-only (it's a set of Claude Code hooks) and does nothing
> in a Codex/Cursor session. In principle that means its coverage shrinks if the
> team diversifies agents. In practice, per the team, non-Claude-Code work
> (e.g. the occasional GPT-5 Codex PR like #476) is **rare**, so today this is a
> near-complete-coverage tool, not a partial one. Keeping the agent-agnostic
> PR-time CodeQL + Code Review as the real gate already covers the rare
> exceptions. Revisit only if non-Claude-Code authoring becomes common.

### Does it belong inside `/commit` // `/ship`, or is it orthogonal?
**Orthogonal — and that's the right design.** The plugin is built entirely on
**hooks** (`SessionStart`, `UserPromptSubmit`, `PostToolUse`, `Stop`); it fires
automatically regardless of which Skill is running. We should **not** fold
plugin invocation into the Skills — there is nothing to invoke, and doing so
would couple a deterministic procedure to an advisory model review.

They layer cleanly: the Skills provide **deterministic guardrails** (`/commit`'s
suspicious-file blocker; deterministic `git add --` staging; the `npm test`
gate; the expand/contract refusal), and the plugin provides **advisory model
review** underneath. Two interaction wrinkles worth flagging, both manageable:

1. **`/commit`'s single bundled approval checkpoint vs. layer 3 timing.**
   `/commit` is designed around *one* human approval block before it commits.
   Layer 3 fires on the `git commit` Bash call — **after** the human already
   approved — and surfaces findings as a follow-up re-prompt. That's not a
   conflict (nothing is blocked), but it slightly dilutes the "single
   checkpoint" property PR #133 worked hard for. Worth a one-line note in the
   Skills docs if we adopt.
2. **Layer 2's re-prompt vs. the Skills' fixed step-list.** The end-of-turn
   review can re-prompt Claude up to 3× to fix findings, adding turns the
   deterministic step-list didn't plan for. In practice this is fine (it just
   means more work happens), but reviewers should expect occasional extra
   follow-up turns during a `/commit`.

Note one thing that *changed* since PR #133: `/commit` and `/pr` are now
**natural-language-invokable** (only `/ship` keeps `disable-model-invocation:
true`). That doesn't change the orthogonality conclusion — the plugin's hooks
fire on the underlying Edit/Bash tool calls regardless of how the Skill was
triggered — but it does mean the plugin's advisory re-prompts can now show up in
ordinary "commit this" flows, not just explicit `/commit` runs. Another reason
to document the interaction rather than bury it.

Neither wrinkle argues against adoption; both argue for documenting the
interaction.

---

## 7. The Windows / Mac split (called out explicitly)

Windows is a **first-class supported platform** here, not hypothetical:
`docs/setup-dev-machine.md` carries explicit Windows instructions (nvm-windows,
Docker Desktop on the WSL 2 backend, `winget install GitHub.cli`);
`.gitattributes` exists specifically to force `eol=lf` because *"Windows
contributors with the default `core.autocrlf=true` get CRLF in the working
tree"*; and the checked-in `.claude/settings.json` even carries a
`PowerShell(gh pr merge *)` permission alongside the `Bash(...)` one — fresh
evidence that someone runs the tooling on native Windows. So at least some of
the team develops on Windows.

**TODO(team):** confirm the current OS split across the roster (the `/pr`
reviewer picker implies ~5–6 collaborators: AlexisChen99, benjifriedman,
Ceantaur/Sean, james-baker, oolu4236/OLA, plus Blake/NorsemanSpiff). Who is on
Windows?

Plugin behavior by platform:

| Capability | Mac/Linux | Windows |
|---|---|---|
| Layer 1 (per-edit pattern) | ✅ | ✅ |
| Layer 2 (end-of-turn review) | ✅ | ✅ |
| Layer 3 (agentic commit review) | ✅ full agentic (venv + Agent SDK) | ⚠️ **single-shot fallback** unless `claude-agent-sdk` already importable (venv step skipped) |
| First-run setup | venv + `pip` install (needs network) | venv skipped |

**Implication:** layers 1 and 2 — which carry most of the value for our XSS /
authz / injection threat model — are **consistent across OS**. Only the
deepest, most expensive, most-redundant layer 3 degrades on Windows. So the
OS split is a **real but bounded** concern: it costs Windows users review
*depth* on commits, not *coverage* of the common cases. **Python 3.8+ on `PATH`
is still a hard prereq on every machine, Windows included.**

**WSL nuance:** our Windows setup runs Docker on the **WSL 2 backend**
(`docs/setup-dev-machine.md`). A dev who runs Claude Code *inside* a WSL
distro is on Linux as far as the plugin is concerned and gets the **full
agentic layer 3** (venv + Agent SDK); only Claude Code running as a *native
Windows* process hits the single-shot fallback (which is consistent with the
`PowerShell(...)` permission entry — someone is on native Windows). So the
degradation may affect fewer people than "we have Windows devs" implies.
**TODO(team):** do Windows devs run Claude Code natively or under WSL?

**Cloud sessions are effectively Linux** and get full capability — *if* the
plugin is enabled there, which requires the checked-in scope (§8), because
user-scope enablement does not reach Claude Code on the web.

---

## 8. Implementation options

A repo-specific wrinkle gates the checked-in options: **`.gitignore` ignores
`.claude/*` and re-includes only `.claude/skills/` and (now)
`!.claude/settings.json` (line 50).** So a checked-in `.claude/settings.json`
is *already tracked* — but `claude-security-guidance.md` and
`security-patterns.json` would still be **silently ignored** unless we add
explicit re-include lines for them. This is a change from the 2026-05-30 draft,
when no `settings.json` existed at all: the file now exists on `main` (currently
just a `gh pr merge` permission gate), so enabling the plugin is **editing an
existing tracked file**, not creating the first one.

### Option A — User-scope opt-in (per developer)
Each dev runs `/plugin install … @claude-plugins-official` at user scope.

| Dimension | Assessment |
|---|---|
| Complexity | Lowest — no repo change |
| Maintainability | Low effort, but no shared config; rules drift per machine |
| Cost/usage | Each dev's own usage; easy to opt out |
| Cross-platform consistency | **Poor** — depends on each machine's Python + OS; **no cloud-session coverage** |
| Rollout friction | Low to start, but no enforcement and easy to forget; new teammates don't inherit it |

### Option B — Checked-in repo-wide enablement (`.claude/settings.json`)
Add `enabledPlugins` to the existing checked-in `.claude/settings.json`. Ideally
ship the **extension files** too (Option B′), which still need a `.gitignore`
re-include.

| Dimension | Assessment |
|---|---|
| Complexity | Moderate — edit existing settings file + `.gitignore` re-include for the rule files + CLAUDE.md/devjournal updates |
| Maintainability | One shared config; rules live in-repo and version with the code |
| Cost/usage | Turns on model-backed layers for everyone by default (each dev can opt out locally via `.claude/settings.local.json` or `SECURITY_GUIDANCE_DISABLE=1`) |
| Cross-platform consistency | **Best achievable** — layers 1&2 uniform; **covers cloud / Claude Code on the web and the `@claude` action**; only layer 3 degrades on native Windows |
| Rollout friction | Everyone who clones gets it; Python 3.8+ becomes a soft prereq (**add to `docs/setup-dev-machine.md`**) |

**Option B′ (recommended variant):** B **plus** a checked-in
`claude-security-guidance.md` and `security-patterns.json` encoding our threat
model (§6). This is where the differentiated value lives.

### Option C — Org-managed enforcement (managed settings)
Admin enables org-wide; only an admin can disable.

| Dimension | Assessment |
|---|---|
| Complexity | Highest — needs org admin + managed-settings distribution |
| Maintainability | Centralized, but changes route through an admin |
| Cost/usage | Mandatory for everyone; no per-dev opt-out |
| Cross-platform consistency | Same as B for layer behavior; strongest *enforcement* |
| Rollout friction | Heaviest governance; overkill for a ~6-person network and removes individual judgment |

### Option D — Hybrid / phased (a variant, and my actual recommendation)
Pilot at user scope → then check in (Option B′) but **start conservative on the
costly layers**: enable everywhere, optionally set `ENABLE_STOP_REVIEW` /
`ENABLE_COMMIT_REVIEW` or a cheaper `SECURITY_REVIEW_MODEL` until pilot cost
data justifies full Opus 4.7 on every turn. Defer Option C indefinitely.

---

## 9. Recommendation

**Adopt via Option D: a phased rollout landing on Option B′ (checked-in
enablement + checked-in threat-model rule files), with the expensive
model-backed layers tuned by pilot data.** Defer org-managed enforcement
(Option C) until the team is larger or has a standing org admin.

Rationale:
- The **free layer 1** reinforces our top named risk (XSS /
  `dangerouslySetInnerHTML`) at the cheapest possible point, and our own threat
  doc says the CSP can't catch that class.
- The **checked-in scope is the only one that reaches cloud sessions and the
  `@claude` action**, which is where Claude writes code without a local machine
  in the loop — exactly where in-session review is most valuable. Since
  effectively all authored code flows through Claude Code (§3), checked-in
  enablement is near-complete coverage, not partial.
- The **custom rule files** give us coverage CodeQL/Code-Review structurally
  can't (our policies, not language rules) — the real differentiator.
- Phasing respects two things this team already cares about: **per-edit hook
  latency** (devjournal 2026-05-29) and **usage cost** (we already pay for
  PR-time Code Review). Measure before making the costly layers mandatory.
- It treats the OS split honestly: the layers that matter most are
  OS-consistent; only the most-redundant layer degrades on native Windows,
  which is acceptable.

**Honest caveat on magnitude.** For a ~6-person, invite-only membership app
whose threat model explicitly *isn't* "sophisticated targeted attacker," and
which already runs CodeQL `security-extended` + multi-agent PR Code Review +
secret scanning + the ~40-item hardening pass in `plan-security-hardening.md`,
the marginal vulnerability this plugin catches that *all* of those miss is
small. The high-confidence value is **layer 1 + the custom rule files**; layers
2 and 3 are genuinely nice-to-have, not need-to-have. Shelving the costly layers
(or the whole thing) is a defensible call — this is a low-urgency improvement,
not a gap that needs closing.

**Also recommended:** add the guidance / patterns files (and keep
`.claude/settings.json`) under **`.github/CODEOWNERS`**, mirroring the existing
workflow-tamper rationale (`plan-security-hardening.md` item 6). A checked-in
settings file that decides which plugins and hooks run in everyone's
session — including cloud — deserves the same "can't land unreviewed" gate as
`.github/workflows/`.

---

## 10. Rollout & validation plan

**Phase 0 — Prerequisite check (before anything).**
- [ ] Confirm every active dev's Claude Code CLI is **≥ 2.1.144**. **TODO(team).**
- [ ] Confirm **Python 3.8+** on `PATH` for each machine (Windows included).
      **TODO(team).**
- [ ] Confirm the OS roster split (§7). **TODO(team).**
- [ ] Confirm the team's Claude plan and appetite for added in-session usage.
      **TODO(team).**
- [ ] Confirm whether `claude-code-action` (the `@claude` workflow, GH-hosted
      Linux runner with network + Python) actually **loads checked-in
      `enabledPlugins`** and can build the venv. **TODO(verify) in a throwaway
      PR before relying on it.**

**Phase 1 — Pilot (1 dev, user scope, ~1 week).**
- One volunteer (suggest Blake, who owns the Skills + Biome-hook precedent)
  installs at user scope on Mac/Linux and on a Windows machine if available.
- Measure and record in `docs/devjournal.md`:
  - Per-edit (layer 1) latency — does it reproduce the ~1.1s concern, or is the
    Python string-match path cheaper?
  - False-positive rate and noise of layers 2 & 3 on real `/commit` runs.
  - Added usage/cost per typical session (and whether a cheaper
    `SECURITY_REVIEW_MODEL` is acceptable).
  - Interaction friction with `/commit`'s single-approval checkpoint (§6).

**Phase 2 — Check-in (Option B′), in one PR via the normal `/ship` flow.**
- [ ] Add `"enabledPlugins": {"security-guidance@claude-plugins-official": true}`
      to the existing `.claude/settings.json`.
- [ ] Edit `.gitignore` to re-include the rule files (still ignored under
      `.claude/*`): add `!.claude/claude-security-guidance.md` and
      `!.claude/security-patterns.json`. (`!.claude/settings.json` is already
      present at line 50.)
- [ ] Add `.claude/claude-security-guidance.md` encoding the §6 rules from
      `docs/strategy-security.md`.
- [ ] Add `.claude/security-patterns.json` (**JSON, not YAML** — PyYAML isn't
      guaranteed importable) with the §6 deterministic patterns.
- [ ] Tune costly layers per Phase-1 data (model override and/or
      `ENABLE_*` env defaults).
- [ ] Add the rule files (+ `.claude/settings.json`) to `.github/CODEOWNERS`.
- [ ] Update `docs/setup-dev-machine.md` with the Python 3.8+ / CLI ≥ 2.1.144
      prereqs.
- [ ] Update `CLAUDE.md` (AI Skills / CI sections) to note the plugin runs
      under the Skills and is orthogonal to them (§6 wrinkles).
- [ ] Add a `docs/devjournal.md` entry (this is a hard devjournal trigger per
      `/commit`'s list: it's effectively a CI/governance + AI-tooling change).

**Phase 3 — Validate the checked-in path actually works.**
- [ ] Smoke-test in a **fresh Claude Code on the web session** (clone → confirm
      the plugin loads and reviews fire — this very environment is the test
      bed).
- [ ] Smoke-test a `/commit` end-to-end and confirm layer 3 fires on the Bash
      commit without breaking the approval flow.
- [ ] Confirm Windows devs get layers 1 & 2 and a graceful layer-3 fallback (no
      hard error).
- [ ] Re-run `npm test` and the normal PR checks (CodeQL, Code Review, E2E) to
      confirm no regression in the existing stack.

**Phase 4 — Review & decide on layer-3 / org-managed.**
- After ~2 weeks of checked-in use, review cost + signal. Decide whether to
  promote the costly layers to full Opus 4.7 everywhere, and whether Option C
  (org-managed) is ever warranted. Record the outcome here (update Status).

**Rollback:** any dev can set `SECURITY_GUIDANCE_DISABLE=1` or override in
`.claude/settings.local.json`; team-wide rollback is reverting the Phase-2 PR.
No production surface is touched — this is dev-tooling only.

---

## 11. Open questions / TODOs (consolidated)

- **TODO(team):** Cloud-session usage frequency (weights §6/§7).
- **TODO(team):** OS roster split — who's on Windows, native vs WSL? (§7)
- **TODO(team):** CLI ≥ 2.1.144 and Python 3.8+ on every machine? (§10 Phase 0)
- **TODO(team):** Claude plan + tolerance for added in-session usage? (§6)
- **TODO(verify):** Does `claude-code-action` honor checked-in `enabledPlugins`
  and build the venv on its runner? (§10 Phase 0)
- **TODO(decision):** Default model for layers 2/3 — full Opus 4.7, or a cheaper
  override to start? (§6, §10 Phase 1)
- **TODO(decision):** Confirm CODEOWNERS gate on the `.claude/` config files. (§9)

---

## Appendix A — File citations index

- `.github/workflows/codeql.yml` — CodeQL (js-ts + actions, security-extended)
- `.github/workflows/claude-code-review.yml` — PR-time multi-agent Code Review
- `.github/workflows/claude.yml` — `@claude` mention bot
- `.github/workflows/ci.yml` — Biome/typecheck/migrate/functional + docs-only skip
- `.github/workflows/e2e.yml` — Playwright on `deployment_status`
- `.github/dependabot.yml` — npm + actions, cooldown mirrors `.npmrc`
- `.github/CODEOWNERS` — workflow tamper-gate (@james-baker, @benjifriedman)
- `.github/PULL_REQUEST_TEMPLATE.md` — PR body convention
- `.npmrc` — `min-release-age=3` supply-chain quarantine
- `docs/strategy-security.md` — threat model, CSP/headers, secret rotation
- `docs/plan-security-hardening.md` — item 6 (workflow gate rationale), hardening inventory
- `docs/devjournal.md` (2026-05-29, Blake) — per-edit hook latency precedent
- `docs/setup-dev-machine.md` — explicit Windows (nvm-windows, WSL 2) + Mac setup
- `.claude/skills/commit/SKILL.md` — staging/blocker/test-gate/expand-contract (now NL-invokable)
- `.claude/skills/pr/SKILL.md` (NL-invokable), `.claude/skills/ship/SKILL.md` (`disable-model-invocation: true`)
- `.claude/settings.json` — existing checked-in settings (currently a `gh pr merge` permission gate)
- `lefthook.yml`, `scripts/biome-precommit.mjs` — local pre-commit hook
- `.gitattributes` — `eol=lf` (evidence of Windows contributors)
- `.gitignore` (line 45 `.claude/*`, line 46 `!.claude/skills/`, line 50 `!.claude/settings.json`)
- `vercel.json`, `biome.json`, `package.json` (Node 24.x) — build/format/runtime

## Appendix B — Plugin reference

<https://code.claude.com/docs/en/security-guidance> (facts captured 2026-05-30,
re-verified unchanged 2026-06-29; re-verify again at adoption). Related:
`/en/code-review`, `/en/hooks`, `/en/admin-setup`, `/en/discover-plugins`.
