import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    root: ".",
    // .claude/** is excluded because agent worktrees land there; without
    // this, Vitest double-collects the same tests from the worktree copy.
    exclude: ["tests/e2e/**", "node_modules/**", ".claude/**"],
    setupFiles: ["tests/functional/setup.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
