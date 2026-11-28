import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { decide, lastTypedMessage, OPT_OUT_FILE } from "../../../.claude/hooks/ship-merge-gate.mjs";

// The merge gate only ever asks; it never allows. These tests pin when it asks: always,
// unless the machine opted out and the last message the human typed is `/ship`.
// Transcript entries mirror Claude Code's JSONL (checked with a headless probe, 2026-11-28):
// a typed command is a `user` entry with string content; skill text Claude Code injects is
// `isMeta: true`; tool output is a `user` entry whose content holds `tool_result` parts.

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const HOOK = path.join(REPO_ROOT, ".claude", "hooks", "ship-merge-gate.mjs");
const SHIP =
  "<command-message>ship</command-message>\n<command-name>/ship</command-name>\n<command-args>717</command-args>";

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "merge-gate-"));
  fs.mkdirSync(path.join(dir, ".claude"));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const typed = (content: unknown) => ({ type: "user", message: { role: "user", content } });
const meta = (text: string) => ({
  type: "user",
  isMeta: true,
  message: { role: "user", content: [{ type: "text", text }] },
});
const toolResult = (text: string) => ({
  type: "user",
  message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: text }] },
});
const assistant = (text: string) => ({
  type: "assistant",
  message: { role: "assistant", content: [{ type: "text", text }] },
});
const jsonl = (...entries: object[]) => `${entries.map((e) => JSON.stringify(e)).join("\n")}\n`;

function transcript(...entries: object[]) {
  const file = path.join(dir, "transcript.jsonl");
  fs.writeFileSync(file, jsonl(...entries));
  return file;
}
const optOut = () => fs.writeFileSync(path.join(dir, OPT_OUT_FILE), "opt-out\n");
const SAFE = 'Looks safe to me. Merging PR #12 "feat: x" — required green.';
const run = (command: string, transcriptPath?: string, description = SAFE) =>
  decide({ command, projectDir: dir, transcriptPath, description });

describe("lastTypedMessage", () => {
  it("returns the typed /ship command, skipping injected skill text and tool output after it", () => {
    expect(
      lastTypedMessage(jsonl(typed("hi"), typed(SHIP), meta("Base directory for this skill"), toolResult("ok"))),
    ).toBe(SHIP);
  });

  it("does not count /ship text that arrives as tool output or injected text", () => {
    expect(lastTypedMessage(jsonl(typed("merge it"), toolResult(SHIP), meta(SHIP), assistant(SHIP)))).toBe("merge it");
  });

  it("reads a typed message sent as text parts, and skips lines that aren't JSON", () => {
    expect(lastTypedMessage(`${jsonl(typed(SHIP))}not json\n${jsonl(typed([{ type: "text", text: "yes" }]))}`)).toBe(
      "yes",
    );
  });

  it("skips entries Claude Code writes itself: task notifications, reminders, local output, summaries", () => {
    const written = [
      typed("<task-notification>\n<task-id>b1</task-id>\n<status>completed</status>\n</task-notification>"),
      typed("<system-reminder>context</system-reminder>"),
      typed("<local-command-stdout>ok</local-command-stdout>"),
      { type: "user", isCompactSummary: true, message: { role: "user", content: "summary" } },
    ];
    expect(lastTypedMessage(jsonl(typed(SHIP), ...written))).toBe(SHIP);
  });

  it("returns empty for a transcript with no typed message", () => {
    expect(lastTypedMessage(jsonl(meta("x"), toolResult("y")))).toBe("");
  });
});

describe("decide", () => {
  it("ignores commands that are not merges", () => {
    expect(run("gh pr view 12")).toBeNull();
    expect(run("git merge origin/main")).toBeNull();
  });

  it("asks when the machine has not opted out, even inside /ship", () => {
    expect(run("gh pr merge 12 --merge --delete-branch", transcript(typed(SHIP)))?.reason).toMatch(
      /merge confirmation is on/,
    );
  });

  it('stays silent on an opted-out machine after a typed /ship, when the merge says "Looks safe to me"', () => {
    optOut();
    expect(
      run("gh pr merge 12 --merge --delete-branch", transcript(typed(SHIP), meta("skill"), toolResult("ok"))),
    ).toBeNull();
    expect(run("gh pr merge 12 --merge --delete-branch", transcript(typed(SHIP)), `  ${SAFE}`)).toBeNull();
  });

  it('asks when the merge doesn\'t say "Looks safe to me": a doubt, a missing description, or the words later on', () => {
    optOut();
    const ship = transcript(typed(SHIP));
    const doubt = "Asking for merge confirmation: someone else's PR — PR 12 is by a teammate.";
    expect(run("gh pr merge 12 --merge --delete-branch", ship, doubt)?.reason).toMatch(
      /didn't say this merge "Looks safe to me"/,
    );
    expect(run("gh pr merge 12 --merge --delete-branch", ship, "")?.decision).toBe("ask");
    expect(run("gh pr merge 12 --merge --delete-branch", ship, `Merging. ${SAFE}`)?.decision).toBe("ask");
  });

  it("asks on an opted-out machine when the human typed something after /ship", () => {
    optOut();
    const result = run("gh pr merge 12 --merge --delete-branch", transcript(typed(SHIP), typed("yes, merge anyway")));
    expect(result?.decision).toBe("ask");
    expect(result?.reason).toMatch(/isn't \/ship/);
  });

  it("asks on an opted-out machine when /ship only appears in tool output", () => {
    optOut();
    expect(
      run("gh pr merge 12 --merge --delete-branch", transcript(typed("please merge"), toolResult(SHIP)))?.decision,
    ).toBe("ask");
  });

  it("asks when the transcript is missing or unreadable", () => {
    optOut();
    expect(run("gh pr merge 12 --merge --delete-branch")?.reason).toMatch(/could not read/);
    expect(run("gh pr merge 12 --merge --delete-branch", path.join(dir, "nope.jsonl"))?.reason).toMatch(
      /could not read/,
    );
  });

  it("asks for any command that mentions a merge, whatever its shape", () => {
    expect(run('grep -rn "gh pr merge" docs')?.decision).toBe("ask");
    expect(run("cd x && gh pr merge 12 --merge --delete-branch && rm -rf ~")?.decision).toBe("ask");
  });
});

describe("hook process", () => {
  const spawn = (stdin: string, hook = HOOK) =>
    spawnSync(process.execPath, [hook], {
      input: stdin,
      env: { ...process.env, CLAUDE_PROJECT_DIR: dir },
      encoding: "utf8",
    });
  const mergeInput = (transcriptPath?: string) =>
    JSON.stringify({
      tool_name: "Bash",
      transcript_path: transcriptPath,
      tool_input: { command: "gh pr merge 5 --merge --delete-branch", description: SAFE },
    });

  it("prints an ask decision for a merge and exits 0", () => {
    const out = spawn(mergeInput());
    expect(out.status).toBe(0);
    expect(JSON.parse(out.stdout).hookSpecificOutput).toMatchObject({
      hookEventName: "PreToolUse",
      permissionDecision: "ask",
    });
  });

  it("prints nothing when it stays silent, and for an ordinary command", () => {
    optOut();
    expect(spawn(mergeInput(transcript(typed(SHIP)))).stdout).toBe("");
    expect(spawn(JSON.stringify({ tool_name: "PowerShell", tool_input: { command: "Get-ChildItem" } })).stdout).toBe(
      "",
    );
  });

  it("asks when its input cannot be parsed, and reads input that starts with a byte-order mark", () => {
    expect(JSON.parse(spawn("not json").stdout).hookSpecificOutput.permissionDecision).toBe("ask");
    expect(JSON.parse(spawn(`﻿${mergeInput()}`).stdout).hookSpecificOutput.permissionDecisionReason).toMatch(
      /merge confirmation is on/,
    );
  });

  it("still runs when reached through a symlinked folder", () => {
    const link = path.join(dir, "linked-hooks");
    try {
      fs.symlinkSync(path.dirname(HOOK), link, "junction");
    } catch {
      return; // symlinks unavailable here; nothing to test
    }
    const out = spawn(mergeInput(), path.join(link, path.basename(HOOK)));
    expect(JSON.parse(out.stdout).hookSpecificOutput.permissionDecision).toBe("ask");
  });
});

describe("checked-in settings and /ship's grant", () => {
  const settings = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, ".claude", "settings.json"), "utf8"));
  const entry = settings.hooks.PreToolUse.find((e: { matcher: string }) => e.matcher === "Bash|PowerShell");

  it("registers the gate for Bash and PowerShell, failing closed, with no `if` filter", () => {
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
    for (const hook of entry.hooks) expect(hook.if).toBeUndefined();
  });

  it("asks for --admin, --auto and other-repo merges in both shells", () => {
    expect(settings.permissions.ask).toEqual(
      expect.arrayContaining(
        ["--admin", "--auto", "-R", "--repo"].flatMap((flag) => [
          `Bash(gh pr merge *${flag}*)`,
          `PowerShell(gh pr merge *${flag}*)`,
        ]),
      ),
    );
  });

  it("/ship grants exactly the merge command it runs, and nothing broader", () => {
    const skill = fs.readFileSync(path.join(REPO_ROOT, ".claude", "skills", "ship", "SKILL.md"), "utf8");
    const front = skill.split(/^---$/m)[1];
    // A one-line YAML flow list, which is also valid JSON.
    const line = /^allowed-tools:\s*(\[.*\])\s*$/m.exec(front);
    expect(line, "allowed-tools must be a one-line list").not.toBeNull();
    const grants = JSON.parse(line?.[1] ?? "[]");
    expect(grants).toEqual([
      "Bash(gh pr merge * --merge --delete-branch)",
      "PowerShell(gh pr merge * --merge --delete-branch)",
    ]);
  });
});
