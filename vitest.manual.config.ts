import path from "node:path";
import { defineConfig } from "vitest/config";

// Manual-test config. `npm test` uses vitest.config.ts and never
// touches tests/manual/. This config is invoked only by the
// special:buttondown:record-api and test:manual:buttondown-api-replay
// npm scripts, each targeting a specific file.
export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
  test: {
    environment: "node",
    include: ["tests/manual/**/*.test.ts"],
  },
});
