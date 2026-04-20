import { expect, test } from "@playwright/test";

import {
  deleteTestUser,
  expectAuthed,
  signInAsNewUser,
} from "./helpers/session";

// Sanity test for the session-minting helper itself. Later phases build
// signed-in tests on top of this helper — if this fails, the rest of the
// signed-in e2e surface is meaningless.

test("session helper lands an authed user off /login", async ({ page }) => {
  const user = await signInAsNewUser(page, "session-helper");
  try {
    await expectAuthed(page);
    // Fresh users have a null bio → `/` redirects to `/welcome`. That's
    // fine — the point is just that we're past the /login gate.
    await expect(page).toHaveURL(/\/welcome|\/$/);
  } finally {
    await deleteTestUser(user.id);
  }
});
