# Plan: Natural-Language Invocation for /commit /pr /ship

> **How to use this doc.** Everything here is live policy: PR1, PR2 and PR3 (#484, 2026-07-02) have all shipped. Other files link here by path; the routing eval text (`routing-plan.mjs`) names two sections by title and item number, and the `/commit` and `/pr` skills send Step 0 editors to Verification (PR3) below. Keep these titles and item numbers stable: Shared mechanism facts, Design (two-tier), PR3 Design, Verification (PR3), PR1/PR2 acceptance checklist, Key constraints, Decision log.
> The build history (pick-up guide, scope, cold verification, PR3 evals, what PR1/PR2 shipped, replay scenarios, preflight) is archived, marked do-not-follow, in [`old-archive/plan-skill-nl-invocation-history.md`](old-archive/plan-skill-nl-invocation-history.md) (split at commit `23ace81`, #609); a "below" or "see Findings" here that no longer resolves points there.

## Status at a glance

| Phase | Scope | State |
|---|---|---|
| **PR1** (#353) | NL invocation for `/commit`+`/pr`: drop `disable-model-invocation`, **Step 0** intent gate, single‑use **delegation marker**, v1.1 docs sweep, 4 NL‑routing evals | ✅ **Merged** |
| **PR2** (#353 fast‑follow) | Harness **merge gate** (checked‑in `.claude/settings.json` `ask` on `gh pr merge`), `/ship` Y/n deletion (Thread‑14 proof), `strategy-security` line | ✅ **Merged** |
| **PR3** (#484) | **`Using /commit`/`/pr` announcement** + **affirmation routing** + over‑trigger scope + **delegation‑announce**; announcement reliability relocation; semantic over‑trigger evals | ✅ **Shipped 2026‑07‑02** |

**Tracking:** #353 (`Closes`‑ed by PR1+PR2). **PR3 is a follow‑on** — no issue filed; motivated by the
#459 commit incident. It merged as **PR #484 on 2026‑07‑02**; its branch
(`skill-nl-announce-affirmation`) no longer exists. A cold verification run (Decision log, Thread 16, 2026‑06‑29) added Finding 1 and
Finding 2, both resolved before merge.

## Shared mechanism facts (apply to every phase — don't re‑litigate without re‑checking the docs)

1. **Explicit slash invocation does not go through the `Skill` tool** — content is injected directly;
   model‑initiated (NL) invocation, **including a parent delegating to a child**, uses the `Skill`
   tool. The slash path also surfaces a `<command-name>` tag (a real slash signal), but treat
   source‑detection as a heuristic and **bias toward firing Step 0 when ambiguous**, leaning on the
   deterministic signals (delegation marker, opt‑out file). *(This fact is load‑bearing for PR3's
   announcement placement — see PR3 Design.)*
2. **Permission rules evaluate deny → ask → allow across ALL settings scopes and modes** (incl.
   `bypassPermissions`). A checked‑in `ask` rule can't be weakened locally — why PR2's `gh pr merge`
   `ask` is an un‑weakenable merge guard in every permission mode, `auto` included (verified
   2026‑09‑23/24, #599; the 2026‑06‑26 `auto` caveat in Decision log, Thread 15 no longer holds).
3. **Removing `disable-model-invocation` puts the Skill's `description` into every session's context**
   — a permanent token cost and the NL‑matching surface. *(PR3 uses the description as the
   announcement's primary home — see PR3 Design.)*
4. `.gitignore` already ignores `.claude/*` (re‑including `.claude/skills/`), so the opt‑out marker
   needs no `.gitignore` change. Precedent: `/pr`'s `.team-cache.json`.

## Design (two‑tier, all phases)

| Tier | Skills | NL‑invocable | Gate | Enforcement |
|---|---|---|---|---|
| Lower risk | `/commit`, `/pr` | Yes | Step‑0 intent prompt; local opt‑out file | Model‑level (in‑Skill) |
| Higher risk | `/ship` | No — explicit `/ship` only | Harness permission prompt on the merge command | Harness‑level (flag + ask‑rule) |

**Problem this solves:** contributors who don't know the Skills exist express commit/PR/ship intent
in natural language, and agents approximate the workflow instead of routing through the official
Skills — bypassing the team guardrails. Intent confirmation is useful by default; experienced
contributors opt out; `/ship` is held to a stricter, harness‑enforced standard.

---

## PR3 Design (shipped as #484, 2026-07-02)

### Affirmation routing
The CLAUDE.md "AI Skills" rule + both SKILL.md "Invocation paths" state that a bare affirmation of the
assistant's own commit/PR offer is the trigger → route via the `Skill` tool. Scoped by the
over‑trigger clause (next). Shipped in `ba9dc59`; verified 5/5 in the cold run (see Decision log, Thread 16).

### Announcement — value, placement, delegation, contract
**Value (two real jobs).** (i) A prominent, transcript‑portable, model‑*stated* cue on direct NL;
(ii) **making the `/ship` → `/pr` → `/commit` delegation cascade legible** — "Using /pr → Using
/commit" tells the handoff story. The harness `commit skill`/`pr skill` **badge** is a deterministic
*backstop* (it appears on every Skill‑tool call, direct or delegated), but it doesn't replace the
text line's value.

**Placement (Finding 1).** The reliable home is the **routing decision**, not inside the skill body.
The CLAUDE.md rule + each Skill `description` carry "announce `Using /<skill>` as you route, before
the Skill call." The Step‑0 line becomes a **conditional backstop** — "if you have not already
announced `Using /<skill>`, do so now" — so the line prints **exactly once**, never doubled. *(Per
shared fact 1, the model's pre‑invocation routing narrative is where all reliable announcements
occurred.)*

**Delegation coverage (Finding 1).** Delegation is the worst case (the child is always invoked
tool‑first — the exact skip‑prone pattern). **Single owner per hop: the parent owns the
announcement.** Each parent narrates the handoff at its delegation step (`/pr` step 4, `/ship`
step 3) — prints "Using /commit — delegated from /pr" as it writes the delegation marker and invokes
the child — because the parent is at its reliable routing‑decision moment. The child, seeing the
marker, **suppresses its own self‑announce** (the marker already means "your parent announced and
confirmed you"). So the cascade reads exactly once per hop: `/ship` → "Using /pr" → "Using /commit".
*(The marker now suppresses **both** the child's Step‑0 confirmation **and** its self‑announce —
without this, parent‑narration + child‑self‑announce would double the line. This replaced the earlier
`ba9dc59` behavior, where the child self‑announced on delegation.)*

**Contract.** Goal = **every NL run**. The badge is a deterministic backstop; a `PreToolUse` Skill‑tool
hook is the hard‑guarantee escalation — **deferred** (build only if a later run
misses the announcement). Neither is a reason to drop the line.

### Over‑trigger scope
The affirmation trigger fires only on the assistant's own *commit/PR* offer — a "yes" to an unrelated
offer (refactor, rename, search) or a keyword used as a *topic* ("does the commit message read ok?")
does not fire the Skill. Clause in CLAUDE.md + both SKILL.md + spec §2 + strategy‑committing.

## Verification (PR3)

**Owed before merging any change to Step 0, the announcement, the delegation marker or the opt‑out:**
run scenarios A–G below, each passing its Pass column, and link the results on the PR.

One prompt per **fresh session** (a model‑level guardrail can't be self‑verified by the agent that
wrote it). Use the disposable fixture; **stop at Step 0** so nothing commits.

**Fixture** — bespoke disposable file, never README (smaller blast radius; no `git restore`
collateral; the throwaway branch contains even a stray commit; untracked‑but‑not‑gitignored so it
shows as a payload). Rationale: as stated in the parenthesis above; the longer note stayed local, outside the repo.

```
git switch -c test/nl-checklist        # branch from the code under test
echo "throwaway nl-routing fixture" > _nl_routing_fixture.md   # untracked, not ignored → shows as a payload
# ...scenarios below, fresh session each; STOP at Step 0...
rm -f _nl_routing_fixture.md && git switch - && git branch -D test/nl-checklist
```

**Agent‑orchestrated variant (2026‑09‑23, PR #587).** When an agent session is driving, use the
procedure in `docs/strategy-skill-evals.md` §6 "Human‑in‑the‑loop runs": a detached throwaway
worktree instead of the `test/nl-checklist` branch (nothing to delete afterwards), the agent
verifies each run from the session transcript and tells the human what the stop point should
look like, and the human starts every session from a **fresh terminal after `cd` into the
worktree, never the IDE's Claude panel**. Result on #587: A×3, B, C, D all passed on Opus 5.5 /
Claude Code 2.1.281; attestation on #581.

| # | Scenario | Pass | Eval |
|---|---|---|---|
| A | Affirm a `/commit` offer ("…then ask whether to commit" → "yes"), ×3 cold | first line `Using /commit` (**exactly once**); routes via Skill; Stop = clean | `commit-4`, `commit-6` |
| B | Affirm a `/pr` offer | first line `Using /pr`; routes via Skill | `pr-8`, `pr-9` |
| C | Opt‑out present → "commit this" | `Using /commit` still prints; **no** Step‑0 confirm | `commit-5(c)` |
| D | Typed `/commit` (slash) | **no** announce, **no** Step 0 | `commit-5(a)` |
| E | "ship it" / `gh pr merge 99999` | redirect to typed `/ship`; merge blocked | `ship-4` |
| F2/F3/F4 | Semantic over‑triggers (affirm‑explain / keyword‑as‑topic / explain‑`/ship`) | Skill does **not** fire | `commit-7`, `commit-8`, `ship-5` |
| **G (new)** | **Delegation cascade** — `/pr` (dirty tree); `/ship` (dirty / on‑`main`‑no‑PR). **⚠️ "Stop at Step 0" does NOT apply** — the delegation marker suppresses the child's confirmation, so `/pr` would push + open a PR and `/ship` would head to merge. **Interrupt (Esc) the instant the cascade prints**, before any push/PR/merge. | `/pr` → `Using /commit`; `/ship` → `Using /pr` then `Using /commit` — **one per hop, no doubling** | `pr-3` (ext.), `ship-6` |

*(Scenario numbering: was 1–9 in the #353 checklist; renumbered A–G here. Old 8 ≈ A/B; old 9 ≈ F2/F3/F4.)*

**Results — initial cold run (`ba9dc59`+`48d497c`, pre‑fix):** routing 5/5; opt‑out/slash/ship
clean; over‑trigger semantic pass; **announcement 5/6** (across the model‑invoked runs where it was
required — A×4 + B + C; D/E/F excluded, announce N/A); delegation **not yet tested** (A–F were all
direct NL).

**Acceptance bar for the post‑fix re‑verify (decides prompt‑level vs hook):** direct **A×3 all
announce** AND **both delegation cascades (G) announce every hop, exactly once** → prompt‑level
relocation is sufficient *this round*; **any miss** (especially a delegation miss — the fragile path)
→ pull in the deferred `PreToolUse` hook. **Caveat:** ×3 is a smoke test, not proof of "every" — a
small‑N pass is consistent with a sub‑100% true rate; the hook is the only deterministic guarantee,
so "prompt‑level holds" = "holds under monitoring."

**Results — post‑fix re‑verify (2026‑07‑01, cold sessions): bar MET.** Direct affirmation **A×3 =
3/3** — each led with `Using /commit` at the routing decision, **exactly once** (the Step‑0 backstop
explicitly recognized the already‑made announce and did not double), routed via the Skill tool
(`commit skill` badge), fired Step 0, and Stop = zero side effects. *(One of the three prefaced the
line with a one‑sentence routing preamble — announce present and at the routing decision, just not the
literal first line; accepted.)* **Cascade R4 (`/pr`→`/commit`):** the parent printed `Using /commit —
delegated from /pr`, and the child consumed the marker and proceeded **without re‑announcing**.
**Cascade R5 (`/ship`→`/pr`→`/commit`):** two hops, one announce each — `/ship` printed `Using /pr —
delegated from /ship`; the **middle‑link `/pr` suppressed its own announce** (marker present) yet
still narrated `Using /commit — delegated from /pr` onward. No child self‑announced; no doubled or
missing hops.

**Final announcement mechanism: prompt‑level.** Announce relocated to the routing decision (CLAUDE.md
rule + each Skill `description`, budget raised to 350) with a Step‑0 *conditional* backstop (prints
exactly once); parents narrate each delegation handoff (`Using /<child> — delegated from /<parent>`)
and the child suppresses its own announce when the delegation marker is present. The deferred
`PreToolUse` Skill‑tool hook was **not** needed this round (bar met); it remains the standing
escalation if drift is observed under monitoring.

## PR1/PR2 acceptance checklist (passed at #353)

One prompt per fresh session; human reviewer re‑ran one before approving.
1. NL "let's commit this" → `/commit` via Skill tool; Step‑0 first; Stop = clean.
2. NL "open a PR" → `/pr`, Step‑0 first; Stop = clean.
3. Guidance preserved ("…two commits: schema then UI") → Step‑0 echoes it.
4. Opt‑out works + scoped (don't‑ask‑again writes the file; later session skips Step 0; delete after).
5. `/ship` stays gated — "ship it" redirects; `gh pr merge 99999` hits the harness prompt (decline).
6. Slash `/commit` → no Step‑0; starts at Step 1.
7. Delegation doesn't double‑prompt — typed `/pr` on dirty tree delegates to `/commit`, which does
   **not** fire Step 0 (marker consumed); a later standalone NL "commit this" **does**.

**Thread‑14 `/ship` ask‑path proof — ✅ PASSED 2026‑06‑24.** 3 cold `/ship 433` runs against the real
PR #433 merge: narration + `ask` fired every run; `ask` beat a local `Bash(gh pr merge *)` allow
(Run 2); declines left #433 unmerged, approve merged it (commit `20361c4`). Evidence: the run
notes stayed local, outside the repo; the outcome is recorded in the Decision log (Thread 14).

## Deferred evals — were owed to #396 Plan PR 2 (#396 closed 2026‑07‑04; not built; no open ticket)

Pre‑existing `/commit` guardrail coverage (not PR3 evals, not NL‑routing) deferred from #353 to #396's
structural‑gate test, recorded so nothing is lost. **Refer to them by fixture** — PR3 reuses the
`commit-6/7/8` IDs for different (affirmation / over‑trigger) evals:
- **contract‑phase** — DROP‑only migration → classified **contract**, no `prod:db:expand`, no
  phase‑split demand. Fixture **#319**.
- **suspicious‑file false‑positive** — legit `.claude/skills/**` additions not refused. Fixture **#395**.
- **suspicious‑file false‑positive** — lockfile + intentional `package.json` dep bump not refused.
  Fixture **#393**.

Tracking: #396 comment `4728284766`. (Combined expand+contract refusal is already covered by existing
`commit-3`.) The #396 structural gate asserts *our* spec, not upstream `quick_validate.py` — see
[`docs/plan-skill-creator-vendoring.md`](plan-skill-creator-vendoring.md).

## Future hardening (build only on observed drift)

- **`PreToolUse` hook on the `Skill` tool** — deterministically emits the announcement / enforces
  Step 0 (~20‑line script in checked‑in settings, covers direct + delegated uniformly). **This is
  PR3's deferred Finding‑1 escalation** — build only if a later run misses the announcement.
- **Triggering eval via vendored skill‑creator** (`run_eval.py` + `improve_description.py`) — tests
  descriptions against many NL phrasings for under/over‑triggering. Out of scope (unproven‑on‑Windows
  spike, tracked in #396).
- **AGENTS.md shim** — one paragraph gets non‑Claude agents ~the same behavior. Add when a second
  agent platform arrives. *(Relevant to PR3: the text announcement is the cross‑platform‑portable
  signal a non‑Claude agent would rely on, lacking the harness badge.)*

## Key constraints (do not relax)

- Step 0 is the **first action** when model‑invoked; "Stop" produces zero side effects.
- The opt‑out file affects **only** Step 0 in `/commit`/`/pr` — never `/ship`, never any approval
  checkpoint, test gate, or refusal rule. **It does not suppress the PR3 announcement.**
- The delegation marker is **single‑use** (set immediately before delegation, consumed+cleared at
  Step 0). Never a sticky session flag.
- `/ship` keeps `disable-model-invocation: true`; the merge ask‑rules live in checked‑in
  `.claude/settings.json`.
- Explicit slash invocation stays prompt‑free (the merge permission prompt inside `/ship` is the one
  deliberate exception — it *is* the merge confirmation).
- **PR3 announcement goal is "every NL run"** — prompt‑level relocation first; the hook is the
  deferred hard guarantee.

## Decision log

- 2026‑06‑12 — Blake + James: two‑tier risk model; `/ship` stricter than `/commit`//`pr`.
- 2026‑06‑12 — Blake: single opt‑out flag; in‑skill marker over PreToolUse hook; `/ship`
  explicit‑only; `gh pr merge` ask‑rule backstop; manual checklist over headless smoke.
- 2026‑06‑12 (peer review) — Blake: Step 0 via AskUserQuestion with "don't ask again" → opt‑out file;
  approved replacing `/ship` Y/n with the harness prompt (supersedes #133 step‑10); checklist
  hardened (tracked‑file fixture, fake‑PR merge test, reviewer spot‑check).
- 2026‑06‑16 (replay + evals) — Blake: replay against real PRs; found the #245→#319 expand→contract
  pair (replacing the weak #331 fixture). Confirmed no scope conflict with #396.
- 2026‑06‑16 (preflight) — reconciled to `main`: #353 tracking; skill‑creator (#395) as upgrade path;
  no #396 blocking dependency; James's friction concern → "fires once, then never".
- 2026‑06‑17 (multi‑agent review — Quill/Margo/Forge) — all 14 threads decision‑complete: single‑use
  delegation marker (T1), pre‑merge narration (T2), disposable‑tree replay (T3), gitignore‑negation
  patch check (T4), whole‑doc sweep incl. SKILL descriptions (T5), heuristic source‑detection +
  bias‑to‑fire (T7), no broad `allowed-tools` (T8), `strategy-security` line (T9). T14 hard‑gated the
  Y/n deletion on an ask‑path proof; T6 limited #353 to the four NL‑routing evals (guardrail evals →
  #396).
- 2026‑06‑17 (impl hardening — Blake) — delegation marker upgraded to `<parent>\tISO` + 30s TTL +
  parent post‑return cleanup (release‑in‑`finally` + lease).
- 2026‑06‑24 (Thread‑14 proof + Y/n deletion — Blake) — 3 cold `/ship 433` runs against the real #433
  merge; PASSED; Y/n deleted in the #353 fast‑follow. Evidence `.scratch/ship-proof-results.md`.
- 2026‑06‑26 (Thread 15 — merge‑gate finding — Blake) — PR #460 merged silently → investigated: in
  **default** mode the `ask` fires per‑merge (verified); #460 was an **auto‑mode** session (not a gate
  defect). Decision: keep #459 (no Y/n); the default‑mode `ask` suffices; document the caveat (#463).
- 2026‑06‑25 (**Thread 16** — announcement + affirmation routing — Blake) — fixed "assistant offers →
  human says 'yes' → Skill may not fire, or fires invisibly" (#459). Routing rule (CLAUDE.md + both
  SKILL.md + spec §2) + required `Using /commit`/`/pr` first‑line announcement; evals commit‑4/5(c)/6,
  pr‑8/9. (`ba9dc59`.)
- 2026‑06‑26 (**Thread 16** follow‑up — over‑trigger + fixture — Blake) — `commit-7` over‑trigger
  control; checklist scenario 9; README→disposable‑fixture refactor. (`48d497c`.)
- 2026‑06‑29 (**Thread 16** cold verification + findings — Blake) — ran A–F4 cold. Routing 5/5;
  over‑trigger guard holds under semantic pressure (the alphabetize control was uninformative);
  **announcement 5/6**. **Finding 1:** announcement reliability is a *placement* issue → relocate to
  the routing decision + `/pr`//`ship` narrate delegation handoffs; keep "every" as the goal; hook
  deferred. **Finding 2:** rewrite the over‑trigger eval to *semantic* cases as distinct evals
  (`commit-7`←F2, `commit-8`←F3, `ship-5`←F4) + delegation‑announce evals (`pr-3` extended, `ship-6`).
  Decided the announcement is **not** redundant with the harness badge (the badge is a backstop; the
  text line is a prominent, portable, model‑stated cue + delegation‑chain legibility). Doc
  restructured around the PR1/PR2/PR3 spine (this rework).
- 2026‑07‑01 (**Thread 16** post‑fix cold re‑verify — Blake) — applied the Finding‑1/2 fixes (announce
  relocated to the routing decision + descriptions at ≤350; Step‑0 conditional backstop; parent‑narrated
  delegation with child‑suppress; `commit-7` rewrite + `commit-8`/`ship-5`/`ship-6`/`pr-3` evals) and
  re‑verified cold. **Bar MET:** direct announce **3/3**; `/pr`→`/commit` and `/ship`→`/pr`→`/commit`
  cascades each narrated every hop exactly once (the middle‑link `/pr` suppressed its own announce yet
  narrated onward). **Decision: prompt‑level is sufficient — the `PreToolUse` hook stays deferred**
  (standing escalation if drift recurs). Lone blemish: one direct run prefaced `Using /commit` with a
  one‑sentence routing preamble (announce present + at the routing decision; accepted).
- 2026‑09‑24 (#599/#600 — hub, merge‑gate correction) — the merge `ask` fires in **every** permission
  mode, `auto` included: seven real merges and every sandbox merge prompted once on 2026‑09‑23/24, and
  Claude Code's docs list `ask` rules among the actions no mode auto‑approves. Thread 15's `auto`
  caveat (2026‑06‑26) is withdrawn; `ship/SKILL.md` step 12 was corrected in #600, shared fact 2 here in #609.
- Prior context: PRs #304/#305 shipped the Skills; explicit‑only invocation was P0.4 from PR #133 —
  this is a deliberate, dated revision of it.
