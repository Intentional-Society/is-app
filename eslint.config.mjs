import { defineConfig, globalIgnores } from "eslint/config";
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

export default defineConfig([
  globalIgnores([".next/**", "next-env.d.ts"]),
  ...nextCoreWebVitals,
  ...nextTypescript,
  // Architectural boundary: app code goes through the Hono API, not the
  // data layer directly. See docs/architecture-appstack.md.
  // Exceptions are listed in `ignores` so each escape hatch is visible
  // in review.
  {
    files: ["src/app/**/*.{ts,tsx}", "src/components/**/*.{ts,tsx}"],
    ignores: [
      "src/app/api/**",
      "src/app/auth/callback/route.ts",
    ],
    rules: {
      "no-restricted-imports": ["error", {
        patterns: [{
          group: ["@/server/*"],
          message:
            "App code must go through the Hono API. Use serverApiClient or loadMe from @/lib/api-server (Server Components) or apiClient from @/lib/api (Client Components). See docs/architecture-appstack.md.",
        }],
      }],
    },
  },
]);
