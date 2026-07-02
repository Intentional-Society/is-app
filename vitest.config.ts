import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const alias = { "@": path.resolve(__dirname, "./src") };

export default defineConfig({
  test: {
    // .claude/** is excluded because agent worktrees land there; without
    // this, Vitest double-collects the same tests from the worktree copy.
    exclude: ["tests/e2e/**", "node_modules/**", ".claude/**"],
    projects: [
      {
        resolve: { alias },
        test: {
          name: "functional-server",
          environment: "node",
          include: ["tests/functional/server/**/*.test.{ts,tsx}"],
          setupFiles: ["tests/functional/server/setup.ts"],
        },
      },
      {
        plugins: [react()],
        resolve: { alias },
        test: {
          name: "functional-client",
          environment: "jsdom",
          include: ["tests/functional/client/**/*.test.{ts,tsx}"],
          setupFiles: ["tests/functional/client/setup.ts"],
        },
      },
      {
        // Repo-invariant tests over the team's Claude Code Skills. Pure
        // filesystem reads (no DB, no DOM, no dotenv), so no setup file. Its own
        // project — not folded into functional-server — so a skills contract test
        // has a discoverable home instead of masquerading as a server test.
        resolve: { alias },
        test: {
          name: "functional-skills",
          environment: "node",
          include: ["tests/functional/skills/**/*.test.{ts,tsx}"],
        },
      },
    ],
  },
});
