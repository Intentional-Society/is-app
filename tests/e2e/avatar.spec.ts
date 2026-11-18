import path from "node:path";

import { expect, test } from "./helpers/fixtures";

// Profile-picture upload (#131): a member picks a photo, confirms the
// circular crop, and it is stored and rendered. The `member` reset
// clears any picture an earlier run left on the account.

// The canary: opt out of the suite-wide /_next/image stub so this spec
// drives the real optimizer → Storage → render path end to end. The
// naturalWidth assertion below would catch the optimizer rejecting the
// upstream image (e.g. #469). See tests/e2e/helpers/fixtures.ts.
test.use({ user: "member", mockImages: false });

// A genuine PNG (240×240, one flat colour) so the browser's
// createImageBitmap and the server's sharp decode both succeed. A file
// in the repo, so the spec needs no image library to make one.
const SAMPLE_PNG = path.join(__dirname, "fixtures", "avatar.png");

test("a member can upload, crop, and see their profile picture", async ({ page }) => {
  await page.goto("/me");
  await expect(page.getByRole("button", { name: "Upload photo" })).toBeVisible();

  // The file input is hidden and click-triggered; setInputFiles drives
  // it directly.
  await page.locator('input[type="file"]').setInputFiles(SAMPLE_PNG);

  // The crop modal opens; confirm with the default framing.
  await expect(page.getByText("Position your photo")).toBeVisible();
  const save = page.getByRole("button", { name: "Save photo" });
  await expect(save).toBeEnabled();
  await save.click();

  // On success the modal closes and the action flips to "Change photo".
  await expect(page.getByRole("button", { name: "Change photo" })).toBeVisible();

  // The picture renders on a fresh page load too — and actually loads
  // (naturalWidth > 0), which would catch the optimizer rejecting the
  // upstream image.
  await page.goto("/me");
  const avatarImg = page.locator("main img").first();
  await expect(avatarImg).toBeVisible();
  await expect.poll(() => avatarImg.evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
});
