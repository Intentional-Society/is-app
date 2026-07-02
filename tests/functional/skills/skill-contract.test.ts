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

  // Committed acceptance artifacts. `evals/evals.json` holds the team Skills'
  // evals; `evals/skill-creator.evals.json` holds the vendored copy's. Each file
  // nests eval cases under ONE `skill_path` per skill — so count cases *within* a
  // skill's group, not `skill_path` occurrences. Plan PR 2, assertion 6.
  describe("eval acceptance artifacts", () => {
    const EVAL_FILES = ["evals/evals.json", "evals/skill-creator.evals.json"];
    const MIN_EVALS = 3;

    it.each(EVAL_FILES)("%s — every skill_path resolves and carries ≥3 evals", (file) => {
      const parsed = JSON.parse(readFileSync(file, "utf8")) as {
        skills: { skill_name: string; skill_path: string; evals?: unknown[] }[];
      };

      const problems: string[] = [];
      for (const skill of parsed.skills) {
        if (!existsSync(skill.skill_path)) {
          problems.push(`${skill.skill_name}: skill_path "${skill.skill_path}" does not resolve`);
        }
        const count = Array.isArray(skill.evals) ? skill.evals.length : 0;
        if (count < MIN_EVALS) {
          problems.push(`${skill.skill_name}: ${count} evals (need ≥${MIN_EVALS})`);
        }
      }
      expect(problems).toEqual([]);
    });
  });
});
