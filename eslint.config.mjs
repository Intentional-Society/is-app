import { defineConfig, globalIgnores } from "eslint/config";
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

export default defineConfig([
  globalIgnores([".next/**", "next-env.d.ts"]),
  ...nextCoreWebVitals,
  ...nextTypescript,
  // Block the deprecated v5 single-package macro. Use the v6 split macros:
  //   import { Trans as T, Plural } from "@lingui/react/macro";
  //   import { t } from "@lingui/core/macro";
  // See docs/doc-strategy-i18n.md.
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@lingui/macro",
              message:
                "@lingui/macro is the deprecated v5 package. Use @lingui/react/macro for Trans/Plural and @lingui/core/macro for t.",
            },
          ],
        },
      ],
    },
  },
]);
