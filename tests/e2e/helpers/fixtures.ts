// Shared e2e `test`: re-exports `expect`/`Page` unchanged, so a spec adopts the
// suite-wide fixtures by importing from here instead of "@playwright/test" with
// no other edit. The one fixture stubs `/_next/image` — see below.
import { test as base } from "@playwright/test";

export type { Page } from "@playwright/test";
export { expect } from "@playwright/test";

// 1×1 transparent GIF — the ubiquitous tracking-pixel bytes. Returned for
// every `/_next/image` request the browser makes (see the `page` override).
const PIXEL_GIF = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");

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
export const test = base.extend<{ mockImages: boolean }>({
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
