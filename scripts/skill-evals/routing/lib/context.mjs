// Routing-context installer.
//
// Phase-8 routing evals test whether/how a skill *fires* in a fresh session, so the
// three team skills must be *discovered* naturally — not handed to a subagent. This
// module copies the real repo's routing context INTO a harness sandbox repo:
//   - .claude/skills/{commit,pr,ship}/SKILL.md  (the skills to be discovered)
//   - .claude/settings.json                      (the `ask` rule on `gh pr merge`)
//   - CLAUDE.md                                  (carrying the real "AI Skills" section
//                                                 verbatim so NL routing behaves faithfully)
//
// It reads from the REAL repo and writes only into a sandbox proven to be outside it.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
// scripts/skill-evals/routing/lib -> repo root is four levels up.
export const REPO_ROOT = path.resolve(HERE, "..", "..", "..", "..");

const TEAM_SKILLS = ["commit", "pr", "ship"];

/** Extract the "## AI Skills" section from the real repo's CLAUDE.md (verbatim). */
export function extractAiSkillsSection(repoRoot = REPO_ROOT) {
  const md = fs.readFileSync(path.join(repoRoot, "CLAUDE.md"), "utf8");
  const start = md.indexOf("## AI Skills");
  if (start < 0) throw new Error("context: could not find '## AI Skills' in CLAUDE.md");
  const rest = md.slice(start);
  const next = rest.indexOf("\n## ", 5);
  return (next > 0 ? rest.slice(0, next) : rest).trim();
}

/**
 * Populate a sandbox repo with the routing context. Refuses to write into the real repo.
 * @param {string} repoDir  the sandbox's repo/ dir (the executor's cwd).
 * @param {string} [repoRoot]  where to read the real skills/CLAUDE.md/settings from.
 * @returns {{skills:string[], claudeMd:string, settings:string}}
 */
export function populateRoutingContext(repoDir, repoRoot = REPO_ROOT) {
  const resolved = path.resolve(repoDir);
  if (resolved.startsWith(path.resolve(repoRoot))) {
    throw new Error(`context: refusing to populate a path inside the real repo: ${resolved}`);
  }
  if (!fs.existsSync(path.join(resolved, ".skill-eval-sandbox"))) {
    throw new Error(`context: ${resolved} has no .skill-eval-sandbox marker — not a harness sandbox.`);
  }

  for (const s of TEAM_SKILLS) {
    const destDir = path.join(resolved, ".claude", "skills", s);
    fs.mkdirSync(destDir, { recursive: true });
    fs.copyFileSync(path.join(repoRoot, ".claude", "skills", s, "SKILL.md"), path.join(destDir, "SKILL.md"));
  }

  const settingsDest = path.join(resolved, ".claude", "settings.json");
  fs.mkdirSync(path.dirname(settingsDest), { recursive: true });
  fs.copyFileSync(path.join(repoRoot, ".claude", "settings.json"), settingsDest);

  const aiSkills = extractAiSkillsSection(repoRoot);
  const sandboxMd = `# CLAUDE.md (skill-eval routing sandbox)

Throwaway sandbox project for the Phase-8 routing evals. Carries the real repo's
AI Skills routing guidance verbatim so natural-language routing behaves faithfully.

${aiSkills}
`;
  fs.writeFileSync(path.join(resolved, "CLAUDE.md"), sandboxMd);

  return { skills: TEAM_SKILLS, claudeMd: path.join(resolved, "CLAUDE.md"), settings: settingsDest };
}
