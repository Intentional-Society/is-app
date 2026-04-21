import { test as setup } from "@playwright/test";

import { resetSeededUsers } from "./helpers/session";

// Runs once at the top of every e2e run. Wipes profile fields and
// deletes invites for the two seeded users so the welcome spec's
// bio-null-redirect assertion holds and the invites specs start
// with an empty invite list.
setup("reset seeded test users", async ({ baseURL }) => {
  if (!baseURL) {
    throw new Error("reset.setup.ts: baseURL is not configured");
  }
  await resetSeededUsers(baseURL);
});
