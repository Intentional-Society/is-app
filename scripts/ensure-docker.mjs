#!/usr/bin/env node
// Ensure the Docker daemon is reachable. If it isn't, launch Docker
// Desktop (cross-platform) and poll until the daemon comes up.
//
// Used by `npm run dev:db` so developers never have to manually start
// Docker Desktop before `npm run dev` or `npm test`.

import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { platform } from "node:process";

const DAEMON_READY_TIMEOUT_MS = 120_000;
const POLL_INTERVAL_MS = 2_000;

const pingDaemon = () =>
  spawnSync("docker", ["info"], { stdio: "ignore" }).status === 0;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const launchDockerDesktop = () => {
  // Prefer Docker's own CLI verb when available (Docker Desktop 4.37+).
  const cli = spawnSync("docker", ["desktop", "start"], { stdio: "ignore" });
  if (cli.status === 0) return true;

  if (platform === "darwin") {
    return spawnSync("open", ["-a", "Docker"], { stdio: "ignore" }).status === 0;
  }

  if (platform === "win32") {
    const candidates = [
      "C:\\Program Files\\Docker\\Docker\\Docker Desktop.exe",
      "C:\\Program Files (x86)\\Docker\\Docker\\Docker Desktop.exe",
    ];
    for (const path of candidates) {
      if (existsSync(path)) {
        spawn(path, [], { detached: true, stdio: "ignore" }).unref();
        return true;
      }
    }
    return false;
  }

  if (platform === "linux") {
    return (
      spawnSync("systemctl", ["--user", "start", "docker-desktop"], {
        stdio: "ignore",
      }).status === 0
    );
  }

  return false;
};

const main = async () => {
  if (pingDaemon()) return;

  process.stdout.write("Docker daemon not reachable — starting Docker Desktop…\n");

  if (!launchDockerDesktop()) {
    process.stderr.write(
      `Couldn't start Docker Desktop automatically on platform '${platform}'.\n` +
        "Please start it manually, or install it from https://docs.docker.com/desktop.\n",
    );
    process.exit(1);
  }

  const deadline = Date.now() + DAEMON_READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);
    if (pingDaemon()) {
      process.stdout.write("Docker daemon ready.\n");
      return;
    }
  }

  process.stderr.write(
    `Timed out waiting for Docker daemon after ${DAEMON_READY_TIMEOUT_MS / 1000}s. ` +
      "Please check Docker Desktop.\n",
  );
  process.exit(1);
};

main();
