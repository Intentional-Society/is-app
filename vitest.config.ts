import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    root: ".",
    exclude: ["tests/e2e/**", "node_modules/**"],
    setupFiles: ["tests/functional/setup.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
