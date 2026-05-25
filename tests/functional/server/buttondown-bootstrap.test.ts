import { describe, expect, it } from "vitest";

import type { ButtondownSubscriber } from "@/server/buttondown";
import { planBootstrap } from "@/server/buttondown-bootstrap";

const subscriber = (over: Partial<ButtondownSubscriber> & { id: string; email_address: string }): ButtondownSubscriber => ({
  type: "regular",
  tags: [],
  ...over,
});

describe("planBootstrap (decision logic)", () => {
  it("skip-missing-subscriber when Buttondown returns null", () => {
    const plan = planBootstrap({
      subscriber: null,
      appJoinedTaggedPrograms: [
        { programId: "p1", programSlug: "weekly", buttondownTag: "weekly" },
      ],
      managedUniverse: new Set(["weekly"]),
    });
    expect(plan.kind).toBe("skip-missing-subscriber");
  });

  it("skip-unsubscribed leaves the app side untouched", () => {
    const plan = planBootstrap({
      subscriber: subscriber({
        id: "sub_x",
        email_address: "x@example.com",
        type: "unsubscribed",
        tags: ["weekly"],
      }),
      appJoinedTaggedPrograms: [
        { programId: "p1", programSlug: "weekly", buttondownTag: "weekly" },
      ],
      managedUniverse: new Set(["weekly"]),
    });
    expect(plan).toEqual({ kind: "skip-unsubscribed", subscriberId: "sub_x" });
  });

  it("Buttondown-authoritative: queues leaveProgram for memberships Buttondown doesn't show", () => {
    const plan = planBootstrap({
      subscriber: subscriber({
        id: "sub_x",
        email_address: "x@example.com",
        tags: ["weekly"], // Buttondown only shows weekly, not monthly
      }),
      appJoinedTaggedPrograms: [
        { programId: "p1", programSlug: "weekly", buttondownTag: "weekly" },
        { programId: "p2", programSlug: "monthly", buttondownTag: "monthly" },
      ],
      managedUniverse: new Set(["weekly", "monthly"]),
    });
    expect(plan.kind).toBe("reconcile");
    if (plan.kind === "reconcile") {
      expect(plan.programsToLeave).toEqual([{ programId: "p2", programSlug: "monthly" }]);
      // After reconcile, final tags reflect Buttondown's view plus
      // the standing markers — no monthly, since Buttondown didn't
      // show it.
      expect(plan.finalTags.sort()).toEqual(["isweb-member", "returning", "weekly"]);
    }
  });

  it("final tag set includes only managed tags from Buttondown, plus standing markers", () => {
    const plan = planBootstrap({
      subscriber: subscriber({
        id: "sub_x",
        email_address: "x@example.com",
        // human-set tags should be ignored; only managed tags pass through
        tags: ["weekly", "human-vip", "active"],
      }),
      appJoinedTaggedPrograms: [
        { programId: "p1", programSlug: "weekly", buttondownTag: "weekly" },
      ],
      managedUniverse: new Set(["weekly"]),
    });
    expect(plan.kind).toBe("reconcile");
    if (plan.kind === "reconcile") {
      // The legacy `active` tag drops off naturally because it's not
      // in the managed universe and we're rewriting the tag array
      // from scratch (full overwrite). `human-vip` is a human tag
      // we don't authoritatively manage, so it would land outside
      // our final set too — script callers should know that this
      // bootstrap moment is the one time we blow human tags away.
      expect(plan.finalTags.sort()).toEqual(["isweb-member", "returning", "weekly"]);
    }
  });

  it("no leaves when Buttondown agrees with the app side", () => {
    const plan = planBootstrap({
      subscriber: subscriber({
        id: "sub_x",
        email_address: "x@example.com",
        tags: ["weekly", "isweb-member"],
      }),
      appJoinedTaggedPrograms: [
        { programId: "p1", programSlug: "weekly", buttondownTag: "weekly" },
      ],
      managedUniverse: new Set(["weekly"]),
    });
    expect(plan.kind).toBe("reconcile");
    if (plan.kind === "reconcile") {
      expect(plan.programsToLeave).toEqual([]);
    }
  });
});
