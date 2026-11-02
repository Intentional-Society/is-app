import { describe, expect, it, vi } from "vitest";

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}));

import { captureException as Sentry_captureException } from "@sentry/nextjs";

import { captureUnsubscribeAlert } from "@/server/buttondown-runner";

const mockCaptureException = vi.mocked(Sentry_captureException);

describe("captureUnsubscribeAlert", () => {
  it("fingerprints the Sentry event per member so each gets its own issue", () => {
    captureUnsubscribeAlert(
      {
        profileId: "profile-a",
        email: "a@example.com",
        programSlugsHeld: ["weekly-web-updates"],
        buttondownTagsOnSubscriber: ["Weekly Web Updates"],
      },
      { runId: "cron:x" },
    );
    captureUnsubscribeAlert(
      {
        profileId: "profile-b",
        email: "b@example.com",
        programSlugsHeld: ["weekly-web-updates"],
        buttondownTagsOnSubscriber: [],
      },
      { runId: "cron:x" },
    );

    const [first, second] = mockCaptureException.mock.calls;
    expect(first[1]).toMatchObject({ fingerprint: ["buttondown.unsubscribed_member", "profile-a"] });
    expect(second[1]).toMatchObject({ fingerprint: ["buttondown.unsubscribed_member", "profile-b"] });
  });
});
