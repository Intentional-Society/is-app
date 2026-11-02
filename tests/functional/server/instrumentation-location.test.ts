import { existsSync } from "node:fs";
import { expect, it } from "vitest";

// With src/app, next build lists instrumentation.ts for deployment only
// when it sits in src/. A root-level copy still compiles, but the
// deployed function ships without it, so register() never runs and the
// Sentry server SDK never starts in production.
it("keeps instrumentation.ts in src/, where Next deploys it", () => {
  expect(existsSync("src/instrumentation.ts")).toBe(true);
  expect(existsSync("instrumentation.ts")).toBe(false);
});
