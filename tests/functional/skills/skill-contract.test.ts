import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Deterministic structural gate for the team's three portable-procedure Skills
// (/commit, /pr, /ship). It encodes docs/spec-portable-ai-procedures.md §2
// (Tool/platform assumptions, L52–61) and §3 (Architecture, L79–117) as
// assertions that run inside the already-required `Lint & Functional Tests`
// check — no new workflow, no Python, no secrets. See the "PR 2 — Deterministic
// structural gate" section of docs/plan-skill-creator-vendoring.md.
//
// Scope is an explicit allowlist. `.claude/skills/skill-creator/` is Anthropic's
// vendored upstream artifact (pinned in its UPSTREAM.md) and is deliberately NOT
// held to our contract — only its acceptance evals are checked, alongside the
// team Skills', in the eval-artifacts block below.
//
// Deliberately NOT asserted (judgment / LLM territory, spec §3 L115): description
// quality, `## Depends on` accuracy, "passes its eval set", self-hosting.

const SKILLS = ["commit", "pr", "ship"] as const;
type SkillName = (typeof SKILLS)[number];

// Post-NL-revision invocation policy (#353, confirmed on main after #484):
// /commit and /pr omit `disable-model-invocation` (natural-language-invocable);
// /ship keeps it `true` (explicit-only). The key is per-skill, never uniform —
// spec §2 L55 / L58, §3 L92.
const EXPLICIT_ONLY: Record<SkillName, boolean> = {
  commit: false,
  pr: false,
  ship: true,
};

// The four body sections every Skill must carry, in this relative order. Asserted
// as a SUBSEQUENCE, not adjacency — real Skills interleave extra `##` sections
// (e.g. `Stash safety`, `Devjournal trigger list`, `AI co-author trailer
// protocol`) between them. Spec §2 L57, §3 L92.
const REQUIRED_SECTIONS = ["Invocation", "Steps", "Failure modes", "Depends on"];

// Soft cap from skill-creator (spec §3 L92 / L109). Over it → warn, never fail.
const SOFT_LINE_CAP = 500;

type Frontmatter = { keys: Map<string, string>; body: string };

// Minimal top-level YAML-frontmatter reader — enough for the flat `key: value`
// frontmatter our Skills use (name, description, disable-model-invocation),
// without adding a `yaml` dependency. Only column-0 `key:` lines count as keys,
// so a colon inside a quoted description value is captured as part of the value.
function parseFrontmatter(raw: string): Frontmatter {
  const lines = raw.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") {
    throw new Error("no YAML frontmatter (file does not start with `---`)");
  }
  const close = lines.findIndex((line, i) => i > 0 && line.trim() === "---");
  if (close === -1) throw new Error("unterminated YAML frontmatter (no closing `---`)");

  const keys = new Map<string, string>();
  for (const line of lines.slice(1, close)) {
    const match = /^([A-Za-z0-9_-]+):(.*)$/.exec(line);
    if (match) keys.set(match[1], match[2].trim());
  }
  return { keys, body: lines.slice(close + 1).join("\n") };
}

function readSkill(name: SkillName) {
  const path = `.claude/skills/${name}/SKILL.md`;
  const raw = readFileSync(path, "utf8");
  return { path, raw, ...parseFrontmatter(raw) };
}

describe("skill contract — .claude/skills/{commit,pr,ship}", () => {
  describe.each(SKILLS)("%s/SKILL.md", (name) => {
    it("exists with parseable frontmatter carrying name + description", () => {
      const { keys } = readSkill(name);
      expect(keys.get("name")).toBeTruthy();
      expect(keys.get("description")).toBeTruthy();
    });

    it("frontmatter `name` matches the directory name", () => {
      // spec §2 L56 — the directory name is the slash-style invocation name.
      expect(readSkill(name).keys.get("name")).toBe(name);
    });

    it("invocation policy matches the post-NL expectation table", () => {
      const { keys } = readSkill(name);
      if (EXPLICIT_ONLY[name]) {
        expect(keys.get("disable-model-invocation")).toBe("true");
      } else {
        expect(keys.has("disable-model-invocation")).toBe(false);
      }
    });

    it("body sections run Invocation → Steps → Failure modes → Depends on", () => {
      const headings = readSkill(name)
        .body.split(/\r?\n/)
        .map((line) => /^##\s+(.+?)\s*$/.exec(line)?.[1])
        .filter((heading): heading is string => Boolean(heading));

      // Subsequence walk: each required section must be present and its first
      // occurrence must come strictly after the previous one. Out-of-order and
      // missing both surface as a non-empty `missing` list.
      let cursor = -1;
      const missing: string[] = [];
      for (const section of REQUIRED_SECTIONS) {
        const at = headings.indexOf(section, cursor + 1);
        if (at === -1) missing.push(section);
        else cursor = at;
      }
      expect(missing).toEqual([]);
    });

    it(`body stays within the ${SOFT_LINE_CAP}-line soft cap (warn only)`, () => {
      const lines = readSkill(name).raw.split(/\r?\n/).length;
      if (lines > SOFT_LINE_CAP) {
        console.warn(
          `[skill-contract] ${name}/SKILL.md is ${lines} lines (> ${SOFT_LINE_CAP}-line ` +
            "soft cap from skill-creator; spec §3 L92/L109). Consider splitting into " +
            "references/. Warn only — never a failure.",
        );
      }
      expect(lines).toBeGreaterThan(0);
    });
  });

  // Committed acceptance artifacts. Two independent shapes coexist by design (spec
  // II.2a, DP1 Option B; C14 rescope 2026-07-19):
  //
  //  - `evals/skill-creator.evals.json` — the vendored copy's OWN acceptance evals
  //    (C1: the vendored dir stays verbatim upstream, so this file stays at repo root,
  //    in the original multi-skill `{ skills: [...] }` wrapper shape).
  //  - `.claude/skills/{commit,pr,ship}/evals/evals.json` — the team Skills' runnable
  //    eval definitions, split per-skill at Phase 1 into upstream's own documented
  //    per-skill location. Root `evals/evals.json` no longer exists (deleted at Phase 1
  //    completion). Schema reference: docs/strategy-skill-evals.md §3.
  describe("eval acceptance artifacts", () => {
    const MIN_EVALS = 3;

    it("evals/skill-creator.evals.json — skill_path resolves and carries ≥3 evals", () => {
      const file = "evals/skill-creator.evals.json";
      const parsed = JSON.parse(readFileSync(file, "utf8")) as {
        skills: { skill_name: string; skill_path: string; evals?: unknown[] }[];
      };

      const problems: string[] = [];
      for (const skill of parsed.skills) {
        if (!existsSync(skill.skill_path)) {
          problems.push(`${file} — ${skill.skill_name}: skill_path "${skill.skill_path}" does not resolve`);
        }
        const count = Array.isArray(skill.evals) ? skill.evals.length : 0;
        if (count < MIN_EVALS) {
          problems.push(`${file} — ${skill.skill_name}: ${count} evals (need ≥${MIN_EVALS})`);
        }
      }
      expect(problems).toEqual([]);
    });

    it("root evals/evals.json no longer exists (evals moved per-skill in Phase 1)", () => {
      expect(
        existsSync("evals/evals.json"),
        "evals/evals.json should have been deleted when the per-skill split landed " +
          "(C14 rescope, spec II.2a). If this fired, either the delete regressed or a " +
          "tool recreated the file — check git status.",
      ).toBe(false);
    });

    // Allowed `kind` values (spec II.2a / II.2d) and the exact execution-eval ID set
    // pinned from the approved conversion manifest (docs/spec-skill-evals-manifest.md).
    // Pinning IDs (not just a minimum count) means a skill-creator regeneration that
    // silently drops or renames an execution eval fails loudly here instead of shipping
    // a quietly thinner suite (R1 hardening, spec II.5). If an eval-set change here is
    // intentional and reviewed, update this table alongside the manifest — don't loosen
    // the assertion to make it pass.
    const ALLOWED_KINDS = new Set(["execution", "routing"]);
    const EXPECTED_EXECUTION_IDS: Record<SkillName, string[]> = {
      commit: ["commit-1", "commit-2", "commit-3a", "commit-3b"],
      pr: ["pr-1", "pr-2", "pr-3", "pr-4", "pr-5", "pr-6", "pr-7"],
      ship: ["ship-1", "ship-2a", "ship-2b", "ship-2c", "ship-3", "ship-6"],
    };

    type EvalEntry = {
      id: string;
      kind?: string;
      fixture?: string;
      expectations?: unknown[];
    };

    function readSkillEvals(name: SkillName) {
      const path = `.claude/skills/${name}/evals/evals.json`;
      const parsed = JSON.parse(readFileSync(path, "utf8")) as {
        skill_path?: string;
        evals?: EvalEntry[];
      };
      return { path, parsed };
    }

    describe.each(SKILLS)("%s/evals/evals.json", (name) => {
      it(`exists, resolves skill_path to ${name}/SKILL.md, and carries ≥${MIN_EVALS} evals`, () => {
        const path = `.claude/skills/${name}/evals/evals.json`;
        expect(
          existsSync(path),
          `${path} is missing — Phase 1 moved each team Skill's evals into its own ` +
            "skill folder (spec II.2a, DP1 Option B). See docs/strategy-skill-evals.md.",
        ).toBe(true);

        const { parsed } = readSkillEvals(name);
        const expectedSkillPath = `.claude/skills/${name}/SKILL.md`;
        expect(parsed.skill_path, `${path}: "skill_path" must be "${expectedSkillPath}"`).toBe(expectedSkillPath);
        expect(existsSync(expectedSkillPath)).toBe(true);

        const count = Array.isArray(parsed.evals) ? parsed.evals.length : 0;
        expect(count, `${path}: ${count} evals (need ≥${MIN_EVALS})`).toBeGreaterThanOrEqual(MIN_EVALS);
      });

      it("every eval has a valid `kind`; `execution` evals carry `fixture` + ≥1 expectation", () => {
        const { path, parsed } = readSkillEvals(name);
        const problems: string[] = [];

        for (const evalEntry of parsed.evals ?? []) {
          if (!evalEntry.kind || !ALLOWED_KINDS.has(evalEntry.kind)) {
            problems.push(
              `${path} — eval "${evalEntry.id}": kind "${evalEntry.kind}" is not one of ` +
                `${[...ALLOWED_KINDS].join("/")} (see docs/strategy-skill-evals.md §3)`,
            );
            continue;
          }
          if (evalEntry.kind !== "execution") continue;

          if (!evalEntry.fixture) {
            problems.push(
              `${path} — eval "${evalEntry.id}": kind: execution requires a non-empty ` +
                '"fixture" naming the sandbox starting-state profile (docs/strategy-skill-evals.md §3)',
            );
          }
          if (!Array.isArray(evalEntry.expectations) || evalEntry.expectations.length < 1) {
            problems.push(
              `${path} — eval "${evalEntry.id}": kind: execution requires ≥1 ` +
                '"expectations" entry (machine-gradeable assertion; docs/strategy-skill-evals.md §3)',
            );
          }
        }
        expect(problems).toEqual([]);
      });

      it("the execution-eval ID set matches the approved conversion manifest exactly", () => {
        const { path, parsed } = readSkillEvals(name);
        const actual = (parsed.evals ?? [])
          .filter((e) => e.kind === "execution")
          .map((e) => e.id)
          .sort();
        const expected = [...EXPECTED_EXECUTION_IDS[name]].sort();

        expect(
          actual,
          `${path}: execution-eval IDs drifted from the approved conversion manifest ` +
            "(docs/spec-skill-evals-manifest.md). Expected exactly " +
            `[${expected.join(", ")}], got [${actual.join(", ")}]. If this is an ` +
            "intentional, reviewed change, update EXPECTED_EXECUTION_IDS in this test " +
            "alongside the manifest.",
        ).toEqual(expected);
      });
    });
  });
});
