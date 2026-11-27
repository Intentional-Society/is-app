import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  decide,
  MARKER_FILE,
  MARKER_TTL_MS,
  mergeTarget,
  OPT_OUT_FILE,
} from "../../../.claude/hooks/ship-merge-gate.mjs";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const HOOK = path.join(REPO_ROOT, ".claude", "hooks", "ship-merge-gate.mjs");
const NOW = Date.parse("2026-11-24T12:00:00Z");

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "merge-gate-"));
  fs.mkdirSync(path.join(dir, ".claude"));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const optOut = () => fs.writeFileSync(path.join(dir, OPT_OUT_FILE), "opt-out\n");
const authorize = (pr: number, at = NOW, owner = "ship") =>
  fs.writeFileSync(path.join(dir, MARKER_FILE), `${owner}\t${new Date(at).toISOString()}\t${pr}\n`);
const markerExists = () => fs.existsSync(path.join(dir, MARKER_FILE));
const run = (command: string) => decide({ command, projectDir: dir, now: NOW });

describe("mergeTarget", () => {
  it.each([
    ["gh pr merge 123 --merge --delete-branch", 123],
    ["gh pr merge --merge 45", 45],
    ["gh.exe pr merge 7", 7],
    ["gh pr merge https://github.com/o/r/pull/88 --merge", 88],
    ["gh pr merge '9'", 9],
    ["gh pr merge --merge --delete-branch", null],
    ["gh pr merge my-branch --merge", null],
  ])("%s → %s", (command, expected) => {
    expect(mergeTarget(command)).toBe(expected);
  });
});

describe("decide", () => {
  it("ignores commands that are not merges", () => {
    expect(run("gh pr view 12")).toBeNull();
    expect(run("git merge origin/main")).toBeNull();
    expect(run("gh pr checks 12 --watch")).toBeNull();
  });

  it("asks when the machine has not opted out, and clears any marker", () => {
    authorize(12);
    expect(run("gh pr merge 12 --merge --delete-branch")?.decision).toBe("ask");
    expect(markerExists()).toBe(false);
  });

  it("asks on an opted-out machine when /ship wrote no marker", () => {
    optOut();
    const result = run("gh pr merge 12 --merge --delete-branch");
    expect(result?.decision).toBe("ask");
    expect(result?.reason).toMatch(/did not authorize/);
  });

  it("allows a fresh /ship authorization for the same PR, once", () => {
    optOut();
    authorize(12);
    expect(run("gh pr merge 12 --merge --delete-branch")?.decision).toBe("allow");
    expect(markerExists()).toBe(false);
    expect(run("gh pr merge 12 --merge --delete-branch")?.decision).toBe("ask");
  });

  it("matches a merge inside a compound command", () => {
    optOut();
    authorize(12);
    expect(run("cd /repo && gh pr merge 12 --merge --delete-branch")?.decision).toBe("allow");
  });

  it("allows a URL target that matches the marker", () => {
    optOut();
    authorize(88);
    expect(run("gh pr merge https://github.com/o/r/pull/88 --merge")?.decision).toBe("allow");
  });

  it.each([
    ["a stale marker", () => authorize(12, NOW - MARKER_TTL_MS - 1), /stale/],
    ["a future-dated marker", () => authorize(12, NOW + 60_000), /stale/],
    ["a marker from another owner", () => authorize(12, NOW, "pr"), /stale or malformed/],
    ["a marker for another PR", () => authorize(99), /#99.*#12/],
  ])("asks on %s and consumes it", (_label, setup, reason) => {
    optOut();
    setup();
    const result = run("gh pr merge 12 --merge --delete-branch");
    expect(result?.decision).toBe("ask");
    expect(result?.reason).toMatch(reason);
    expect(markerExists()).toBe(false);
  });

  it("asks when the command names no PR", () => {
    optOut();
    authorize(12);
    expect(run("gh pr merge --merge --delete-branch")?.decision).toBe("ask");
  });

  it("asks when one command holds two merges", () => {
    optOut();
    authorize(12);
    expect(run("gh pr merge 12 --merge; gh pr merge 13 --merge")?.decision).toBe("ask");
  });
});

describe("hook process", () => {
  const spawn = (stdin: string) =>
    spawnSync(process.execPath, [HOOK], {
      input: stdin,
      env: { ...process.env, CLAUDE_PROJECT_DIR: dir },
      encoding: "utf8",
    });

  it("prints an ask decision for a merge and exits 0", () => {
    const out = spawn(JSON.stringify({ tool_name: "Bash", tool_input: { command: "gh pr merge 5 --merge" } }));
    expect(out.status).toBe(0);
    expect(JSON.parse(out.stdout).hookSpecificOutput).toMatchObject({
      hookEventName: "PreToolUse",
      permissionDecision: "ask",
    });
  });

  it("prints nothing for an ordinary command", () => {
    const out = spawn(JSON.stringify({ tool_name: "PowerShell", tool_input: { command: "Get-ChildItem" } }));
    expect(out.status).toBe(0);
    expect(out.stdout).toBe("");
  });

  it("asks when its input cannot be parsed", () => {
    const out = spawn("not json");
    expect(out.status).toBe(0);
    expect(JSON.parse(out.stdout).hookSpecificOutput.permissionDecision).toBe("ask");
  });
});

describe("checked-in settings", () => {
  const settings = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, ".claude", "settings.json"), "utf8"));

  it("registers the gate for Bash and PowerShell, failing closed", () => {
    const entry = settings.hooks.PreToolUse.find((e: { matcher: string }) => e.matcher === "Bash|PowerShell");
    expect(entry.hooks).toContainEqual(
      expect.objectContaining({
        type: "command",
        command: "node",
        // A Claude Code path placeholder, not a JS template.
        // biome-ignore lint/suspicious/noTemplateCurlyInString: literal settings.json value
        args: ["${CLAUDE_PROJECT_DIR}/.claude/hooks/ship-merge-gate.mjs"],
        onFailure: "block",
      }),
    );
  });

  it("keeps no `if` filter, so the script sees every shell command", () => {
    const entry = settings.hooks.PreToolUse.find((e: { matcher: string }) => e.matcher === "Bash|PowerShell");
    for (const hook of entry.hooks) expect(hook.if).toBeUndefined();
  });
});
