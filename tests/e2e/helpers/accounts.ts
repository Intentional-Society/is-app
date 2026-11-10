import path from "node:path";

// The server's list of the same accounts, as types only. test-reset.ts
// is server code that opens the database, and the e2e CI job installs
// none of its packages; a type import is erased before the suite runs.
// Typing ACCOUNTS from it makes `tsc` fail when the two lists differ.
import type { E2E_ACCOUNTS, E2EAccountKey } from "../../../src/server/test-reset";

// The seeded e2e accounts (E2E_ACCOUNTS in src/server/test-reset.ts). A
// local run always has them: `npm run test:e2e` runs `npm run dev:db`,
// whose last step is `scripts/seed-e2e-users.mjs` — idempotent, and it
// keeps each password in sync with `.env.local`. CI runs Playwright
// against the Vercel preview, which shares prod Supabase; the same
// accounts are seeded there by hand (docs/doc-supabase.md), never by CI.
export type AccountKey = E2EAccountKey;

type AccountOf<K extends AccountKey> = {
  key: K;
  email: (typeof E2E_ACCOUNTS)[K];
  // Env var holding the account's password: .env.local for local runs,
  // a GitHub Actions secret in CI.
  passwordEnvVar: string;
};

export type Account = { [K in AccountKey]: AccountOf<K> }[AccountKey];

export const ACCOUNTS: { [K in AccountKey]: AccountOf<K> } = {
  regular: { key: "regular", email: "e2e-regular@testfake.local", passwordEnvVar: "E2E_REGULAR_PASSWORD" },
  admin: { key: "admin", email: "e2e-admin@testfake.local", passwordEnvVar: "E2E_ADMIN_PASSWORD" },
};

// The accounts member tests run as, one per Playwright worker: worker N
// owns workerAccounts()[N] for the whole run, so two tests never write to
// the same account at once and each can reset its account freely. The
// length of this list is therefore the suite's parallelism
// (playwright.config.ts sets `workers` from it).
//
// e2e-admin is in the list because member features treat it as an
// ordinary member (isE2EAccount in src/server/auth-middleware.ts caps
// its admin powers). E2E_WORKER_ACCOUNTS overrides the list, e.g.
// `E2E_WORKER_ACCOUNTS=regular` for a single-worker run.
//
// A function, not a constant: playwright.config.ts imports this module
// before its own dotenv call runs (imports are hoisted), so the env var
// is read when the list is asked for.
export const workerAccounts = (): readonly AccountKey[] => {
  const value = process.env.E2E_WORKER_ACCOUNTS;
  if (!value) return ["regular", "admin"];
  const keys = value
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);
  for (const key of keys) {
    if (!(key in ACCOUNTS)) {
      throw new Error(`E2E_WORKER_ACCOUNTS: unknown account "${key}" (known: ${Object.keys(ACCOUNTS).join(", ")})`);
    }
  }
  if (keys.length === 0 || new Set(keys).size !== keys.length) {
    throw new Error("E2E_WORKER_ACCOUNTS must list each account once, and at least one");
  }
  return keys as AccountKey[];
};

// Every account the run signs in as: the worker accounts, plus admin for
// the admin-page specs when it isn't already one of them.
export const sessionAccounts = (): readonly AccountKey[] => {
  const workers = workerAccounts();
  return workers.includes("admin") ? workers : [...workers, "admin"];
};

// Where the setup project saves each account's signed-in browser state.
// The files hold live session tokens until the teardown project signs
// the accounts out, so the directory is gitignored and sits outside
// playwright-report/, the only directory CI uploads.
const AUTH_DIR = path.join("playwright", ".auth");

export const storageStatePath = (key: AccountKey): string => path.join(AUTH_DIR, `${key}.json`);
