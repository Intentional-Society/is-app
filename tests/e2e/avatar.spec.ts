import sharp from "sharp";

import { expect, test } from "./helpers/fixtures";

// Profile-picture upload (#131): a member picks a photo, confirms the
// circular crop, and it is stored and rendered. The `member` reset
// clears any picture an earlier run left on the account.

// The canary: opt out of the suite-wide /_next/image stub so this spec
// drives the real optimizer → Storage → render path end to end. The
// naturalWidth assertion below would catch the optimizer rejecting the
// upstream image (e.g. #469). See tests/e2e/helpers/fixtures.ts.
test.use({ user: "member", mockImages: false });

// A genuine PNG so the browser's createImageBitmap and the server's
// sharp decode both succeed.
const samplePng = (): Promise<Buffer> =>
  sharp({ create: { width: 240, height: 240, channels: 3, background: { r: 210, g: 120, b: 70 } } })
    .png()
    .toBuffer();

test("a member can upload, crop, and see their profile picture", async ({ page }) => {
  await page.goto("/me");
  await expect(page.getByRole("button", { name: "Upload photo" })).toBeVisible();

  // The file input is hidden and click-triggered; setInputFiles drives
  // it directly.
  await page.locator('input[type="file"]').setInputFiles({
    name: "avatar.png",
    mimeType: "image/png",
    buffer: await samplePng(),
  });

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
