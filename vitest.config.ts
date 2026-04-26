import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

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
    ],
  },
});
