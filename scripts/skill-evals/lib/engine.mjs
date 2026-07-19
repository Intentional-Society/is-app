// Node engine floor for the skill-evals harness.
//
// The floor is pinned declaratively in ../package.json ("engines.node"); this module
// enforces it at runtime so a too-old Node fails loudly with a clear message instead of
// throwing an obscure API error deep inside a build step. Kept in sync with package.json
// by hand — both are cheap to read.

export const NODE_ENGINE_FLOOR = "20.0.0";

/** Throw if the running Node is older than the pinned floor. */
export function assertNodeEngine() {
  const runningMajor = Number(process.versions.node.split(".")[0]);
  const floorMajor = Number(NODE_ENGINE_FLOOR.split(".")[0]);
  if (Number.isNaN(runningMajor) || runningMajor < floorMajor) {
    throw new Error(
      `skill-evals harness requires Node >= ${NODE_ENGINE_FLOOR}, but this process is running ${process.version}. ` +
        "Upgrade Node (the repo pins 24.x) and re-run.",
    );
  }
}
