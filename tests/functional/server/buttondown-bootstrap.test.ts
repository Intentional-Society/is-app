import { describe, expect, it } from "vitest";

import type { ButtondownSubscriber } from "@/server/buttondown";
import { planBootstrap, type ProgramRef } from "@/server/buttondown-bootstrap";

const subscriber = (over: Partial<ButtondownSubscriber> & { id: string; email_address: string }): ButtondownSubscriber => ({
  type: "regular",
  tags: [],
  ...over,
});

const programsByTag = (entries: Array<[string, ProgramRef]>): Map<string, ProgramRef> => new Map(entries);

describe("planBootstrap (decision logic)", () => {
  it("skip-missing-subscriber when Buttondown returns null", () => {
    const plan = planBootstrap({
      subscriber: null,
      appJoinedTaggedPrograms: [
        { programId: "p1", programSlug: "weekly", buttondownTag: "weekly" },
      ],
      programsByTag: programsByTag([["weekly", { programId: "p1", programSlug: "weekly" }]]),
    });
    expect(plan.kind).toBe("skip-missing-subscriber");
  });

  it("skip-unsubscribed leaves the app side untouched", () => {
    const plan = planBootstrap({
      subscriber: subscriber({
        id: "sub_x",
        email_address: "x@example.com",
        type: "unsubscribed",
        tags: ["weekly", "isweb-member"],
      }),
      appJoinedTaggedPrograms: [
        { programId: "p1", programSlug: "weekly", buttondownTag: "weekly" },
      ],
      programsByTag: programsByTag([["weekly", { programId: "p1", programSlug: "weekly" }]]),
    });
    expect(plan).toEqual({ kind: "skip-unsubscribed", subscriberId: "sub_x" });
  });

  it("skip-no-isweb-member when subscriber lacks the marker (likely a newsletter-only collision)", () => {
    const plan = planBootstrap({
      subscriber: subscriber({
        id: "sub_x",
        email_address: "x@example.com",
        tags: ["weekly", "human-vip"],
      }),
      appJoinedTaggedPrograms: [
        { programId: "p1", programSlug: "weekly", buttondownTag: "weekly" },
      ],
      programsByTag: programsByTag([["weekly", { programId: "p1", programSlug: "weekly" }]]),
    });
    expect(plan).toEqual({
      kind: "skip-no-isweb-member",
      subscriberId: "sub_x",
      currentTags: ["weekly", "human-vip"],
    });
  });

  it("Buttondown-authoritative: queues leaveProgram for memberships Buttondown doesn't show", () => {
    const plan = planBootstrap({
      subscriber: subscriber({
        id: "sub_x",
        email_address: "x@example.com",
        tags: ["weekly", "isweb-member"], // Buttondown only shows weekly, not monthly
      }),
      appJoinedTaggedPrograms: [
        { programId: "p1", programSlug: "weekly", buttondownTag: "weekly" },
        { programId: "p2", programSlug: "monthly", buttondownTag: "monthly" },
      ],
      programsByTag: programsByTag([
        ["weekly", { programId: "p1", programSlug: "weekly" }],
        ["monthly", { programId: "p2", programSlug: "monthly" }],
      ]),
    });
    expect(plan).toEqual({
      kind: "reconcile",
      subscriberId: "sub_x",
      programsToLeave: [{ programId: "p2", programSlug: "monthly" }],
      programsToJoin: [],
    });
  });

  it("Buttondown-authoritative: surfaces programsToJoin for managed tags the app's joined-programs don't include", () => {
    const plan = planBootstrap({
      subscriber: subscriber({
        id: "sub_x",
        email_address: "x@example.com",
        // Buttondown shows both, app only has weekly — the bootstrap
        // surfaces "monthly" as a programsToJoin so the operator can
        // see whether the cron would silently strip it the next day.
        tags: ["weekly", "monthly", "isweb-member"],
      }),
      appJoinedTaggedPrograms: [
        { programId: "p1", programSlug: "weekly", buttondownTag: "weekly" },
      ],
      programsByTag: programsByTag([
        ["weekly", { programId: "p1", programSlug: "weekly" }],
        ["monthly", { programId: "p2", programSlug: "monthly" }],
      ]),
    });
    expect(plan).toEqual({
      kind: "reconcile",
      subscriberId: "sub_x",
      programsToLeave: [],
      programsToJoin: [{ programId: "p2", programSlug: "monthly" }],
    });
  });

  it("skip-no-changes when Buttondown's managed tags equal the app's program tags", () => {
    const plan = planBootstrap({
      subscriber: subscriber({
        id: "sub_x",
        email_address: "x@example.com",
        // Buttondown holds the standing markers plus exactly the
        // managed tag the app says the member is in. Extra human-set
        // and legacy tags on the subscriber don't matter — the
        // bootstrap doesn't write to Buttondown so it doesn't care
        // about them.
        tags: ["weekly", "isweb-member", "human-vip", "active"],
      }),
      appJoinedTaggedPrograms: [
        { programId: "p1", programSlug: "weekly", buttondownTag: "weekly" },
      ],
      programsByTag: programsByTag([["weekly", { programId: "p1", programSlug: "weekly" }]]),
    });
    expect(plan).toEqual({ kind: "skip-no-changes", subscriberId: "sub_x" });
  });
});
