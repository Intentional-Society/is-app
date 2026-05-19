import { expect, test } from "@playwright/test";
import sharp from "sharp";

import { completeWelcome, resetSeededUsers, signInAs } from "./helpers/session";

// Profile-picture upload (#131): a member picks a photo, confirms the
// circular crop, and it is stored and rendered. Depends on the regular
// seeded user starting clean, so reset per-test.

test.describe.configure({ mode: "serial" });

test.beforeEach(async ({ baseURL }) => {
  if (!baseURL) throw new Error("avatar.spec.ts: baseURL is not configured");
  await resetSeededUsers(baseURL);
});

// A genuine PNG so the browser's createImageBitmap and the server's
// sharp decode both succeed.
const samplePng = (): Promise<Buffer> =>
  sharp({ create: { width: 240, height: 240, channels: 3, background: { r: 210, g: 120, b: 70 } } })
    .png()
    .toBuffer();

test("a member can upload, crop, and see their profile picture", async ({ page }) => {
  await signInAs(page, "regular");
  await completeWelcome(page, { displayName: "Avatar Tester" });

  await page.goto("/profile/edit");
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

  // The picture renders on the profile page too — and actually loads
  // (naturalWidth > 0), which would catch the optimizer rejecting the
  // upstream image.
  await page.goto("/profile");
  const avatarImg = page.locator("main img").first();
  await expect(avatarImg).toBeVisible();
  await expect.poll(() => avatarImg.evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
});
