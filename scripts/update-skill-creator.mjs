#!/usr/bin/env node
// Vendors Anthropic's upstream skill-creator skill into .claude/skills/skill-creator/,
// pinned to the last upstream commit that touched the subdirectory.
// See docs/plan-skill-creator-vendoring.md and docs/doc-skill-creator.md.
//
// Usage:
//   node scripts/update-skill-creator.mjs            # sync to latest upstream, rewrite UPSTREAM.md
//   node scripts/update-skill-creator.mjs --sha=<sha> # sync to a specific upstream commit
//   node scripts/update-skill-creator.mjs --check     # compare pinned vs upstream; no writes.
//                                                     # exit 0 = up to date, 2 = behind, 1 = error
//
// Requires: gh (authenticated), tar (ships with Windows 10+/macOS/Linux), network.
// Never commits — review the diff and ship via /commit.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const UPSTREAM_REPO = "anthropics/skills";
const UPSTREAM_SUBDIR = "skills/skill-creator";
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const targetDir = path.join(repoRoot, ".claude", "skills", "skill-creator");
const upstreamFile = path.join(targetDir, "UPSTREAM.md");

const args = process.argv.slice(2);
const checkOnly = args.includes("--check");
const shaArg = args.find((a) => a.startsWith("--sha="))?.slice("--sha=".length);

function gh(...ghArgs) {
  return execFileSync("gh", ghArgs, { encoding: "utf8" }).trim();
}

function latestUpstreamSha() {
  return gh("api", `repos/${UPSTREAM_REPO}/commits?path=${UPSTREAM_SUBDIR}&per_page=1`, "--jq", ".[0].sha");
}

function pinnedSha() {
  if (!fs.existsSync(upstreamFile)) return null;
  const match = fs.readFileSync(upstreamFile, "utf8").match(/Pinned commit:\s*`([0-9a-f]{40})`/);
  return match ? match[1] : null;
}

if (checkOnly) {
  const pinned = pinnedSha();
  if (!pinned) {
    console.error(`No pinned SHA found in ${upstreamFile} — run without --check to vendor.`);
    process.exit(1);
  }
  const latest = latestUpstreamSha();
  if (pinned === latest) {
    console.log(`skill-creator is up to date (pinned ${pinned.slice(0, 12)}).`);
    process.exit(0);
  }
  console.log(`skill-creator is behind upstream.`);
  console.log(`  pinned:   ${pinned}`);
  console.log(`  upstream: ${latest}`);
  console.log(`  compare:  https://github.com/${UPSTREAM_REPO}/compare/${pinned}...${latest}`);
  console.log(`  refresh:  node scripts/update-skill-creator.mjs`);
  process.exit(2);
}

const sha = shaArg ?? latestUpstreamSha();
if (!/^[0-9a-f]{40}$/.test(sha)) {
  console.error(`Could not resolve a full upstream commit SHA (got: ${JSON.stringify(sha)}).`);
  process.exit(1);
}
console.log(`Vendoring ${UPSTREAM_REPO}/${UPSTREAM_SUBDIR} @ ${sha.slice(0, 12)}…`);

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "skill-creator-"));
try {
  // Download the repo tarball at the pinned SHA and extract only the skill subdir.
  const tarPath = path.join(tmpDir, "upstream.tar.gz");
  const res = await fetch(`https://codeload.github.com/${UPSTREAM_REPO}/tar.gz/${sha}`);
  if (!res.ok) {
    console.error(`Tarball download failed: HTTP ${res.status}`);
    process.exit(1);
  }
  fs.writeFileSync(tarPath, Buffer.from(await res.arrayBuffer()));
  execFileSync("tar", ["-xzf", tarPath, "-C", tmpDir]);

  const extractedRoot = fs
    .readdirSync(tmpDir)
    .map((name) => path.join(tmpDir, name))
    .find((p) => fs.statSync(p).isDirectory());
  const extractedSkill = path.join(extractedRoot, ...UPSTREAM_SUBDIR.split("/"));
  if (!fs.existsSync(path.join(extractedSkill, "SKILL.md"))) {
    console.error(`Extracted tarball has no ${UPSTREAM_SUBDIR}/SKILL.md — aborting, nothing changed.`);
    process.exit(1);
  }

  // Replace, don't overlay: removing the target first propagates upstream deletions.
  // UPSTREAM.md is regenerated below, so nothing in targetDir needs preserving.
  fs.rmSync(targetDir, { recursive: true, force: true });
  fs.cpSync(extractedSkill, targetDir, { recursive: true });

  fs.writeFileSync(
    upstreamFile,
    `# UPSTREAM — vendored copy, do not edit by hand

Source: https://github.com/${UPSTREAM_REPO}/tree/main/${UPSTREAM_SUBDIR}
Pinned commit: \`${sha}\` (last upstream commit touching the subdir)
Vendored: ${new Date().toISOString().slice(0, 10)} via \`node scripts/update-skill-creator.mjs\`
License: Apache-2.0 (see LICENSE.txt in this directory)

Everything in this directory except this file is a verbatim upstream copy.
Check for updates: \`node scripts/update-skill-creator.mjs --check\`
Refresh: \`node scripts/update-skill-creator.mjs\` — then review the diff, run the acceptance
evals in \`evals/skill-creator.evals.json\`, and ship via /commit.
See docs/doc-skill-creator.md for the full procedure.
`,
  );

  const diff = execFileSync("git", ["status", "--porcelain", "--", path.relative(repoRoot, targetDir)], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  console.log(diff.trim() ? `Changes:\n${diff.trimEnd()}` : "No changes — already at this SHA.");
  console.log(`\nPinned ${sha.slice(0, 12)} in UPSTREAM.md. Review the diff, run the acceptance`);
  console.log("evals (evals/skill-creator.evals.json), then ship via /commit. Nothing was committed.");
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}
