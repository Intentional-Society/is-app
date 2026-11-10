// Shared e2e `test`: re-exports `expect`/`Page` unchanged, so a spec adopts the
// suite-wide fixtures by importing from here instead of "@playwright/test".
// The fixtures decide who a test runs as (`user`, `account`) and stub
// `/_next/image` (`mockImages`).
import { test as base } from "@playwright/test";

import { ACCOUNTS, type Account, storageStatePath, workerAccounts } from "./accounts";
import { resetAccounts } from "./session";

export type { Page } from "@playwright/test";
export { expect } from "@playwright/test";

// Who a test runs as. Set per file or describe with `test.use({ user })`.
//   anonymous  — no session. The default.
//   member     — the worker's account, reset to onboarded: `/` renders
//                the signed-in home page.
//   new-member — the worker's account, reset to fresh: `/` enters the
//                welcome flow.
//   admin      — e2e-admin's session, for the admin pages. No reset:
//                these specs only read, and another worker may be
//                running member tests as that account at the same time.
export type UserMode = "anonymous" | "member" | "new-member" | "admin";

// 1×1 transparent GIF — the ubiquitous tracking-pixel bytes. Returned for
// every `/_next/image` request the browser makes (see the `page` override).
const PIXEL_GIF = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");

const ANONYMOUS_STATE = { cookies: [], origins: [] };

type TestFixtures = {
  mockImages: boolean;
  user: UserMode;
  resetWorkerAccount: undefined;
};

type WorkerFixtures = {
  // The account this worker owns for the run (see workerAccounts).
  // `member` and `new-member` tests are signed in as it.
  account: Account;
};

export const test = base.extend<TestFixtures, WorkerFixtures>({
  account: [
    // biome-ignore lint/correctness/noEmptyPattern: Playwright requires the fixtures argument to be a destructuring pattern
    async ({}, use, workerInfo) => {
      const accounts = workerAccounts();
      const { workers } = workerInfo.config;
      if (workers > accounts.length) {
        throw new Error(
          `e2e runs one worker per account: ${workers} workers were requested for ` +
            `${accounts.length} account(s) (${accounts.join(", ")}). ` +
            `Two workers sharing an account would overwrite each other's state.`,
        );
      }
      await use(ACCOUNTS[accounts[workerInfo.parallelIndex]]);
    },
    { scope: "worker" },
  ],

  user: ["anonymous", { option: true }],

  // The browser state the setup project saved for the account, so a
  // signed-in test starts with a session and no sign-in step.
  storageState: async ({ user, account }, use) => {
    if (user === "anonymous") await use(ANONYMOUS_STATE);
    else if (user === "admin") await use(storageStatePath("admin"));
    else await use(storageStatePath(account.key));
  },

  // Puts the worker's account into the state the test's `user` asks for
  // before the test body runs.
  resetWorkerAccount: [
    async ({ user, account, baseURL }, use) => {
      if (user === "member" || user === "new-member") {
        if (!baseURL) throw new Error("e2e fixtures: baseURL is not configured");
        await resetAccounts(baseURL, { account: account.key, state: user === "member" ? "onboarded" : "fresh" });
      }
      await use(undefined);
    },
    { auto: true },
  ],

  // Avatars are the app's only `<Image>`. Rendering one through `next/image`
  // makes the browser hit `/_next/image`, which invokes Vercel's optimizer,
  // which fetches the avatar's full master from Supabase Storage. CI shares the
  // preview→prod Supabase, every preview deploy starts with a cold optimizer
  // cache, and e2e then loads the directory/web-graph on every run — so the
  // suite re-fetches every avatar's master from prod Storage on each run. That
  // was ~60% of avatar Storage egress (docs/design-profile-pictures.md, #382).
  //
  // Fulfilling `/_next/image` in the browser short-circuits that whole chain:
  // the optimizer is never invoked, so Storage is never hit. It's a harness-only
  // stub — the app builds and runs byte-identical; we've only told the browser
  // under test to use a pixel. The real optimizer→Storage→render path is still
  // covered for real by the opt-out canary (avatar.spec.ts sets
  // `test.use({ mockImages: false })`), which asserts naturalWidth > 0.
  mockImages: [true, { option: true }],
  page: async ({ page, mockImages }, use) => {
    if (mockImages) {
      await page.route(/\/_next\/image/, (route) =>
        route.fulfill({ status: 200, contentType: "image/gif", body: PIXEL_GIF }),
      );
    }
    await use(page);
  },
});
