import { expect, test } from "./helpers/fixtures";
import { expectAuthed, signInAs } from "./helpers/session";

// Sanity test for the session helper itself. Signed-in specs build on
// this helper — if sign-in doesn't work, the rest of the signed-in
// e2e surface is meaningless.

test("session helper lands an authed user off /signin", async ({ page }) => {
  await signInAs(page, "regular");
  await expectAuthed(page);
  // By the time this file runs, welcome.spec.ts has filled bio, so the
  // regular user lands on /. If it ever runs before welcome completes,
  // /welcome is the next-best landing spot — either is past /signin.
  await expect(page).toHaveURL(/\/welcome|\/$/);
});
