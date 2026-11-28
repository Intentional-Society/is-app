#!/usr/bin/env node
// grade-ship-merge-gate — script-grade a ship-10 or ship-11 run from its transcript and its
// evidence archive (run archive-evidence.mjs first). Prints grading.json-shaped JSON; exits 0
// when every expectation passes, 1 otherwise.
//
// Usage:
//   node scripts/skill-evals/grade-ship-merge-gate.mjs <ship-10|ship-11> --outputs <dir> --transcript <file.jsonl>
//   node scripts/skill-evals/grade-ship-merge-gate.mjs <ship-10|ship-11> --outputs <dir> --agent <agentId>
//
// --agent finds the executor subagent's transcript, `agent-<agentId>.jsonl`, under
// ~/.claude/projects/*/*/subagents/ (where Claude Code stores subagent transcripts).

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { gradeShipMergeGate, SHIP_MERGE_GATE_EVALS } from "./lib/grade-ship-merge-gate.mjs";

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

if (args.includes("--help") || args.includes("-h") || args.length === 0) {
  process.stdout.write(
    "grade-ship-merge-gate <ship-10|ship-11> --outputs <dir> (--transcript <file.jsonl> | --agent <agentId>)\n" +
      "Grades /shipit step 11's merge authorization from the transcript and the evidence archive.\n",
  );
  process.exit(args.length === 0 ? 2 : 0);
}

function findAgentTranscript(agentId) {
  const projects = path.join(os.homedir(), ".claude", "projects");
  const name = `agent-${agentId}.jsonl`;
  for (const project of fs.existsSync(projects) ? fs.readdirSync(projects) : []) {
    const projectDir = path.join(projects, project);
    if (!fs.statSync(projectDir).isDirectory()) continue;
    for (const session of fs.readdirSync(projectDir)) {
      const candidate = path.join(projectDir, session, "subagents", name);
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return null;
}

const evalId = args.find((a) => !a.startsWith("-") && SHIP_MERGE_GATE_EVALS[a]);
const outputs = flag("--outputs");
const agent = flag("--agent");
const transcript = flag("--transcript") ?? (agent ? findAgentTranscript(agent) : undefined);

if (!evalId || !outputs || !transcript) {
  process.stderr.write(
    `grade-ship-merge-gate: need an eval id (${Object.keys(SHIP_MERGE_GATE_EVALS).join(", ")}), --outputs, and ` +
      `--transcript or a findable --agent.${agent && !transcript ? ` No agent-${agent}.jsonl found.` : ""} See --help.\n`,
  );
  process.exit(2);
}

const result = gradeShipMergeGate({ evalId, transcriptText: fs.readFileSync(transcript, "utf8"), archiveDir: outputs });
process.stdout.write(`${JSON.stringify({ ...result, transcript }, null, 2)}\n`);
process.exit(result.summary.failed === 0 ? 0 : 1);
