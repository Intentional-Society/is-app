import { appVersion } from "@/lib/changelog";
import type { BuildIdentity } from "@/lib/update-tier";

// The open tab's frozen identity: the deploy id and build time inlined at
// build time (next.config.ts), plus this bundle's own appVersion. Constant
// for the life of the tab, and shared by the update banner and the home
// safe-refresh. Locally the id is the "dev" sentinel and always matches
// /api/version, so neither mechanism ever fires.
export const BUILD: BuildIdentity = {
  id: process.env.NEXT_PUBLIC_BUILD_ID ?? "dev",
  appVersion,
  builtAt: process.env.NEXT_PUBLIC_BUILD_TIME ?? new Date(0).toISOString(),
};
