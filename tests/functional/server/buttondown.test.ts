import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  type ButtondownAccount,
  ButtondownApiError,
  ButtondownConflictError,
  type ButtondownSubscriber,
  createButtondownClient,
  isDryRunOutcome,
  isReservedTestEmail,
} from "@/server/buttondown";

import { createFakeButtondownClient } from "./buttondown-fake";

// A realistic-shape subscriber response. Only the fields the client
// projects are asserted on; the API returns more that we ignore.
const sampleSubscriber: ButtondownSubscriber = {
  id: "sub_abc123",
  email_address: "alice@example.com",
  type: "regular",
  tags: ["weekly-updates", "isweb-member"],
};

// Builds a fetch-shaped mock that returns the given status/body for any
// request. Typed with `typeof fetch` so the mock's call records carry
// the (input, init) signature through .mock.calls.
const mockFetch = (status: number, body: unknown) => {
  return vi.fn<typeof fetch>(async () =>
    Promise.resolve(
      new Response(typeof body === "string" ? body : JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      }),
    ),
  );
};

describe("createButtondownClient", () => {
  describe("listSubscribers", () => {
    // Builds a fetcher that returns sequential responses from `pages`,
    // one per call. Lets us simulate cursor pagination.
    const sequentialFetch = (pages: { status: number; body: unknown }[]) => {
      const responses = pages.map(
        (p) =>
          new Response(JSON.stringify(p.body), {
            status: p.status,
            headers: { "content-type": "application/json" },
          }),
      );
      const fetcher = vi.fn<typeof fetch>(async () => {
        const next = responses.shift();
        if (!next) throw new Error("sequentialFetch: out of responses");
        return Promise.resolve(next);
      });
      return fetcher;
    };

    it("returns all subscribers from a single-page response", async () => {
      const subs = [sampleSubscriber, { ...sampleSubscriber, id: "sub_def456" }];
      const fetcher = sequentialFetch([{ status: 200, body: { results: subs, next: null } }]);
      const client = createButtondownClient({ apiKey: "k", write: true, fetcher });

      const got = await client.listSubscribers();
      expect(got).toHaveLength(2);
      expect(got[0]).toEqual(sampleSubscriber);
    });

    it("follows `next` URLs to drain every page", async () => {
      const page1 = [sampleSubscriber];
      const page2 = [{ ...sampleSubscriber, id: "sub_def456", email_address: "bob@example.com" }];
      const page3 = [{ ...sampleSubscriber, id: "sub_ghi789", email_address: "carol@example.com" }];
      const fetcher = sequentialFetch([
        { status: 200, body: { results: page1, next: "https://api.buttondown.com/v1/subscribers?cursor=2" } },
        { status: 200, body: { results: page2, next: "https://api.buttondown.com/v1/subscribers?cursor=3" } },
        { status: 200, body: { results: page3, next: null } },
      ]);
      const client = createButtondownClient({ apiKey: "k", write: true, fetcher });

      const got = await client.listSubscribers();
      expect(got).toHaveLength(3);
      expect(got.map((s) => s.id)).toEqual(["sub_abc123", "sub_def456", "sub_ghi789"]);
      // First call hits the relative path; subsequent calls use the
      // absolute next URL Buttondown handed back.
      expect(fetcher.mock.calls[0][0]).toBe("https://api.buttondown.com/v1/subscribers");
      expect(fetcher.mock.calls[1][0]).toBe("https://api.buttondown.com/v1/subscribers?cursor=2");
      expect(fetcher.mock.calls[2][0]).toBe("https://api.buttondown.com/v1/subscribers?cursor=3");
    });

    it("throws on a non-2xx page response", async () => {
      const fetcher = sequentialFetch([{ status: 500, body: "boom" }]);
      const client = createButtondownClient({ apiKey: "k", write: true, fetcher });
      await expect(client.listSubscribers()).rejects.toBeInstanceOf(ButtondownApiError);
    });

    it("uses the Token auth header on every page request", async () => {
      const fetcher = sequentialFetch([
        {
          status: 200,
          body: { results: [sampleSubscriber], next: "https://api.buttondown.com/v1/subscribers?cursor=2" },
        },
        { status: 200, body: { results: [], next: null } },
      ]);
      const client = createButtondownClient({ apiKey: "secret123", write: true, fetcher });
      await client.listSubscribers();
      for (const call of fetcher.mock.calls) {
        const headers = call[1]?.headers as Record<string, string>;
        expect(headers.Authorization).toBe("Token secret123");
      }
    });
  });

  describe("getSubscriber", () => {
    it("returns the subscriber on 200", async () => {
      const fetcher = mockFetch(200, sampleSubscriber);
      const client = createButtondownClient({ apiKey: "k", write: true, fetcher });

      const got = await client.getSubscriber("alice@example.com");
      expect(got).toEqual(sampleSubscriber);
    });

    it("returns null on 404 (subscriber missing)", async () => {
      const fetcher = mockFetch(404, { detail: "Not found." });
      const client = createButtondownClient({ apiKey: "k", write: true, fetcher });

      const got = await client.getSubscriber("missing@example.com");
      expect(got).toBeNull();
    });

    it("throws ButtondownApiError on other non-2xx", async () => {
      const fetcher = mockFetch(500, "boom");
      const client = createButtondownClient({ apiKey: "k", write: true, fetcher });

      await expect(client.getSubscriber("alice@example.com")).rejects.toBeInstanceOf(ButtondownApiError);
    });

    it("URL-encodes the id-or-email path segment", async () => {
      const fetcher = mockFetch(200, sampleSubscriber);
      const client = createButtondownClient({ apiKey: "k", write: true, fetcher });

      await client.getSubscriber("a+b@example.com");
      expect(fetcher).toHaveBeenCalledOnce();
      const [url] = fetcher.mock.calls[0];
      expect(url).toBe("https://api.buttondown.com/v1/subscribers/a%2Bb%40example.com");
    });

    it("projects the response to the declared four fields, dropping anything else", async () => {
      const withExtras = {
        ...sampleSubscriber,
        creation_date: "2024-01-01T00:00:00Z",
        secondary_id: 12345,
        notes: "ignore me",
        metadata: { foo: "bar" },
      };
      const fetcher = mockFetch(200, withExtras);
      const client = createButtondownClient({ apiKey: "k", write: true, fetcher });

      const got = await client.getSubscriber("alice@example.com");
      expect(got).toEqual(sampleSubscriber);
      expect(Object.keys(got ?? {}).sort()).toEqual(["email_address", "id", "tags", "type"]);
    });

    it("uses the 'Token <key>' auth header (not Bearer)", async () => {
      const fetcher = mockFetch(200, sampleSubscriber);
      const client = createButtondownClient({ apiKey: "secret123", write: true, fetcher });

      await client.getSubscriber("alice@example.com");
      const [, init] = fetcher.mock.calls[0];
      const headers = init?.headers as Record<string, string>;
      expect(headers.Authorization).toBe("Token secret123");
    });
  });

  describe("createSubscriber", () => {
    it("POSTs the input and returns the new subscriber when write=true", async () => {
      const fetcher = mockFetch(201, sampleSubscriber);
      const client = createButtondownClient({ apiKey: "k", write: true, fetcher });

      const result = await client.createSubscriber({
        email_address: "alice@example.com",
        tags: ["weekly-updates", "isweb-member"],
      });
      expect(isDryRunOutcome(result)).toBe(false);
      const [url, init] = fetcher.mock.calls[0];
      expect(url).toBe("https://api.buttondown.com/v1/subscribers");
      expect(init?.method).toBe("POST");
      const body = JSON.parse(init?.body as string);
      expect(body.tags).toEqual(["weekly-updates", "isweb-member"]);
    });

    it("returns a DryRunOutcome and makes no network call when write=false", async () => {
      const fetcher = mockFetch(201, sampleSubscriber);
      const client = createButtondownClient({ apiKey: "k", write: false, fetcher });

      const result = await client.createSubscriber({
        email_address: "alice@example.com",
        tags: ["weekly-updates"],
      });
      expect(isDryRunOutcome(result)).toBe(true);
      if (isDryRunOutcome(result)) {
        expect(result.intent).toBe("create");
        expect(result.payload.email_address).toBe("alice@example.com");
      }
      expect(fetcher).not.toHaveBeenCalled();
    });

    it("throws ButtondownConflictError on 409 (duplicate email)", async () => {
      const fetcher = mockFetch(409, { detail: "Subscriber already exists." });
      const client = createButtondownClient({ apiKey: "k", write: true, fetcher });

      await expect(client.createSubscriber({ email_address: "alice@example.com", tags: [] })).rejects.toBeInstanceOf(
        ButtondownConflictError,
      );
    });

    it("passes `type` through in the POST body when provided", async () => {
      const fetcher = mockFetch(201, sampleSubscriber);
      const client = createButtondownClient({ apiKey: "k", write: true, fetcher });

      await client.createSubscriber({
        email_address: "alice@example.com",
        tags: ["welcome"],
        type: "regular",
      });
      const init = fetcher.mock.calls[0][1];
      const body = JSON.parse(init?.body as string);
      expect(body.type).toBe("regular");
    });
  });

  describe("deleteSubscriber", () => {
    it("DELETEs and returns void on success when write=true", async () => {
      // 204 No Content responses must have a null body; build directly.
      const fetcher = vi.fn<typeof fetch>(async () =>
        Promise.resolve(new Response(null, { status: 204 })),
      );
      const client = createButtondownClient({ apiKey: "k", write: true, fetcher });

      const result = await client.deleteSubscriber("sub_abc123");
      expect(isDryRunOutcome(result)).toBe(false);
      expect(result).toBeUndefined();
      const [url, init] = fetcher.mock.calls[0];
      expect(url).toBe("https://api.buttondown.com/v1/subscribers/sub_abc123");
      expect(init?.method).toBe("DELETE");
    });

    it("returns a DryRunOutcome and makes no network call when write=false", async () => {
      const fetcher = vi.fn<typeof fetch>(async () =>
        Promise.resolve(new Response(null, { status: 204 })),
      );
      const client = createButtondownClient({ apiKey: "k", write: false, fetcher });

      const result = await client.deleteSubscriber("sub_abc123");
      expect(isDryRunOutcome(result)).toBe(true);
      if (isDryRunOutcome(result)) {
        expect(result.intent).toBe("delete");
        expect(result.payload).toEqual({ id: "sub_abc123" });
      }
      expect(fetcher).not.toHaveBeenCalled();
    });

    it("throws ButtondownApiError on non-2xx (e.g., 404)", async () => {
      const fetcher = mockFetch(404, { detail: "Not found." });
      const client = createButtondownClient({ apiKey: "k", write: true, fetcher });

      await expect(client.deleteSubscriber("sub_missing")).rejects.toBeInstanceOf(ButtondownApiError);
    });
  });

  describe("updateSubscriber", () => {
    it("PATCHes and returns the updated subscriber when write=true", async () => {
      const updated = { ...sampleSubscriber, tags: ["new-tag-only"] };
      const fetcher = mockFetch(200, updated);
      const client = createButtondownClient({ apiKey: "k", write: true, fetcher });

      const result = await client.updateSubscriber("sub_abc123", { tags: ["new-tag-only"] });
      expect(isDryRunOutcome(result)).toBe(false);
      const [url, init] = fetcher.mock.calls[0];
      expect(url).toBe("https://api.buttondown.com/v1/subscribers/sub_abc123");
      expect(init?.method).toBe("PATCH");
    });

    it("returns a DryRunOutcome and makes no network call when write=false", async () => {
      const fetcher = mockFetch(200, sampleSubscriber);
      const client = createButtondownClient({ apiKey: "k", write: false, fetcher });

      const result = await client.updateSubscriber("sub_abc123", { email_address: "new@example.com" });
      expect(isDryRunOutcome(result)).toBe(true);
      if (isDryRunOutcome(result)) {
        expect(result.intent).toBe("update");
        expect(result.payload).toEqual({
          id: "sub_abc123",
          patch: { email_address: "new@example.com" },
        });
      }
      expect(fetcher).not.toHaveBeenCalled();
    });

    it("passes `type` through in the PATCH body when provided", async () => {
      const fetcher = mockFetch(200, { ...sampleSubscriber, type: "unsubscribed" });
      const client = createButtondownClient({ apiKey: "k", write: true, fetcher });

      await client.updateSubscriber("sub_abc123", { type: "unsubscribed" });
      const init = fetcher.mock.calls[0][1];
      const body = JSON.parse(init?.body as string);
      expect(body.type).toBe("unsubscribed");
    });
  });

  describe("getAccount", () => {
    const sampleAccount: ButtondownAccount = {
      username: "intentional-society-api-tests",
    };

    it("returns the account identity on 200", async () => {
      const fetcher = mockFetch(200, sampleAccount);
      const client = createButtondownClient({ apiKey: "k", write: true, fetcher });

      const got = await client.getAccount();
      expect(got).toEqual(sampleAccount);
      const [url] = fetcher.mock.calls[0];
      expect(url).toBe("https://api.buttondown.com/v1/accounts/me");
    });

    it("projects the response to {username}, dropping email_address and anything else", async () => {
      const fetcher = mockFetch(200, {
        ...sampleAccount,
        email_address: "owner@example.com",
        plan: "pro",
      });
      const client = createButtondownClient({ apiKey: "k", write: true, fetcher });

      const got = await client.getAccount();
      expect(got).toEqual(sampleAccount);
      expect(Object.keys(got)).toEqual(["username"]);
    });

    it("uses the Token auth header", async () => {
      const fetcher = mockFetch(200, sampleAccount);
      const client = createButtondownClient({ apiKey: "secret123", write: true, fetcher });
      await client.getAccount();
      const headers = fetcher.mock.calls[0][1]?.headers as Record<string, string>;
      expect(headers.Authorization).toBe("Token secret123");
    });

    it("throws ButtondownApiError on non-2xx", async () => {
      const fetcher = mockFetch(403, { detail: "permission denied" });
      const client = createButtondownClient({ apiKey: "k", write: true, fetcher });
      await expect(client.getAccount()).rejects.toBeInstanceOf(ButtondownApiError);
    });
  });

  // Wire-level guard against ever hitting Buttondown with a test
  // fixture email. RFC 6761 reserves .test/.example/.invalid/.localhost
  // and RFC 6762 reserves .local — none can be a real deliverable
  // address. The sync layer also filters these before reaching the
  // client; this is the belt-and-suspenders layer for a future caller
  // that bypasses the sync.
  describe("reserved-TLD wire guard", () => {
    it("getSubscriber refuses an email ending in .local without calling fetch", async () => {
      const fetcher = mockFetch(200, sampleSubscriber);
      const client = createButtondownClient({ apiKey: "k", write: true, fetcher });
      await expect(client.getSubscriber("e2e-regular@testfake.local")).rejects.toBeInstanceOf(ButtondownApiError);
      expect(fetcher).not.toHaveBeenCalled();
    });

    it("createSubscriber refuses a reserved-TLD email without calling fetch", async () => {
      const fetcher = mockFetch(201, sampleSubscriber);
      const client = createButtondownClient({ apiKey: "k", write: true, fetcher });
      await expect(
        client.createSubscriber({ email_address: "x@example.test", tags: [] }),
      ).rejects.toBeInstanceOf(ButtondownApiError);
      expect(fetcher).not.toHaveBeenCalled();
    });

    it("updateSubscriber refuses an email patch with a reserved TLD without calling fetch", async () => {
      const fetcher = mockFetch(200, sampleSubscriber);
      const client = createButtondownClient({ apiKey: "k", write: true, fetcher });
      await expect(
        client.updateSubscriber("sub_abc123", { email_address: "x@some.invalid" }),
      ).rejects.toBeInstanceOf(ButtondownApiError);
      expect(fetcher).not.toHaveBeenCalled();
    });

    it("updateSubscriber with a tags-only patch is unaffected by the guard", async () => {
      const fetcher = mockFetch(200, sampleSubscriber);
      const client = createButtondownClient({ apiKey: "k", write: true, fetcher });
      await client.updateSubscriber("sub_abc123", { tags: ["weekly"] });
      expect(fetcher).toHaveBeenCalledTimes(1);
    });

    it("getSubscriber with a bare subscriber id passes the guard", async () => {
      // Real subscriber ids contain no `@`, so the helper bails out
      // before checking the TLD. Verifies we don't accidentally block
      // id-keyed lookups.
      const fetcher = mockFetch(200, sampleSubscriber);
      const client = createButtondownClient({ apiKey: "k", write: true, fetcher });
      await client.getSubscriber("sub_abc123");
      expect(fetcher).toHaveBeenCalledTimes(1);
    });
  });
});

describe("isReservedTestEmail", () => {
  it("returns true for each RFC-reserved TLD", () => {
    expect(isReservedTestEmail("a@b.local")).toBe(true);
    expect(isReservedTestEmail("a@b.test")).toBe(true);
    expect(isReservedTestEmail("a@b.invalid")).toBe(true);
    expect(isReservedTestEmail("a@b.example")).toBe(true);
    expect(isReservedTestEmail("a@localhost")).toBe(true);
  });

  it("is case-insensitive on the host portion", () => {
    expect(isReservedTestEmail("a@FOO.LOCAL")).toBe(true);
    expect(isReservedTestEmail("a@foo.Test")).toBe(true);
  });

  it("matches multi-label hosts that end in a reserved TLD", () => {
    expect(isReservedTestEmail("a@deep.sub.testfake.local")).toBe(true);
  });

  it("returns false for production-shaped addresses", () => {
    expect(isReservedTestEmail("alice@example.com")).toBe(false);
    expect(isReservedTestEmail("alice@gmail.com")).toBe(false);
    expect(isReservedTestEmail("alice@intentionalsociety.org")).toBe(false);
  });

  it("does not match when the reserved TLD appears mid-label", () => {
    // The host is `not-local.com`, which ends in `.com`, not `.local`.
    expect(isReservedTestEmail("a@not-local.com")).toBe(false);
  });

  it("returns false for inputs with no `@` (subscriber ids)", () => {
    expect(isReservedTestEmail("sub_abc123")).toBe(false);
    // Even an id that contains a reserved-TLD-like substring stays a
    // passthrough — the helper only looks past the last `@`.
    expect(isReservedTestEmail("sub-test")).toBe(false);
  });
});

describe("createFakeButtondownClient", () => {
  let initialSub: ButtondownSubscriber;

  beforeEach(() => {
    initialSub = {
      id: "preexisting_1",
      email_address: "preexisting@example.com",
      type: "regular",
      tags: ["old-tag"],
    };
  });

  it("finds a seeded subscriber by id or email", async () => {
    const fake = createFakeButtondownClient({ write: true, initialSubscribers: [initialSub] });

    expect(await fake.getSubscriber("preexisting_1")).toEqual(initialSub);
    expect(await fake.getSubscriber("preexisting@example.com")).toEqual(initialSub);
    expect(await fake.getSubscriber("PREEXISTING@example.com")).toEqual(initialSub);
    expect(await fake.getSubscriber("nope@example.com")).toBeNull();
  });

  it("creates a new subscriber and records the effect (write=true)", async () => {
    const fake = createFakeButtondownClient({ write: true });
    const result = await fake.createSubscriber({
      email_address: "new@example.com",
      tags: ["welcome"],
    });
    expect(isDryRunOutcome(result)).toBe(false);
    expect(fake.effects).toHaveLength(1);
    expect(fake.effects[0]).toMatchObject({ kind: "create", dryRun: false });
    expect((await fake.getSubscriber("new@example.com"))?.tags).toEqual(["welcome"]);
  });

  it("records a dry-run effect and does not mutate state when write=false", async () => {
    const fake = createFakeButtondownClient({ write: false });
    const result = await fake.createSubscriber({ email_address: "new@example.com", tags: ["welcome"] });
    expect(isDryRunOutcome(result)).toBe(true);
    expect(fake.effects[0]).toMatchObject({ kind: "create", dryRun: true });
    expect(await fake.getSubscriber("new@example.com")).toBeNull();
  });

  it("rejects creates whose email already exists with a 400 ButtondownApiError", async () => {
    const fake = createFakeButtondownClient({ write: true, initialSubscribers: [initialSub] });
    const err = await fake
      .createSubscriber({ email_address: "preexisting@example.com", tags: ["x"] })
      .then(() => null)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ButtondownApiError);
    expect((err as ButtondownApiError).status).toBe(400);
  });

  it("overwrites the tag array on update (no merging)", async () => {
    const fake = createFakeButtondownClient({ write: true, initialSubscribers: [initialSub] });
    await fake.updateSubscriber("preexisting_1", { tags: ["completely", "different"] });
    expect((await fake.getSubscriber("preexisting_1"))?.tags).toEqual(["completely", "different"]);
  });

  it("flips the subscriber type when patch.type is provided", async () => {
    const fake = createFakeButtondownClient({ write: true, initialSubscribers: [initialSub] });
    await fake.updateSubscriber("preexisting_1", { type: "unsubscribed" });
    expect((await fake.getSubscriber("preexisting_1"))?.type).toBe("unsubscribed");
  });

  it("deleteSubscriber removes from the store and records an effect (write=true)", async () => {
    const fake = createFakeButtondownClient({ write: true, initialSubscribers: [initialSub] });
    await fake.deleteSubscriber("preexisting_1");
    expect(await fake.getSubscriber("preexisting_1")).toBeNull();
    expect(fake.effects[0]).toMatchObject({ kind: "delete", id: "preexisting_1", dryRun: false });
  });

  it("deleteSubscriber records a dry-run effect without mutating when write=false", async () => {
    const fake = createFakeButtondownClient({ write: false, initialSubscribers: [initialSub] });
    const result = await fake.deleteSubscriber("preexisting_1");
    expect(isDryRunOutcome(result)).toBe(true);
    expect(await fake.getSubscriber("preexisting_1")).toEqual(initialSub);
    expect(fake.effects[0]).toMatchObject({ kind: "delete", id: "preexisting_1", dryRun: true });
  });

  it("deleteSubscriber throws on missing id (write=true)", async () => {
    const fake = createFakeButtondownClient({ write: true });
    await expect(fake.deleteSubscriber("never_existed")).rejects.toBeInstanceOf(ButtondownApiError);
  });

  it("getAccount returns the default api-tests identity when no override is set", async () => {
    const fake = createFakeButtondownClient({ write: true });
    const account = await fake.getAccount();
    expect(account.username).toBe("intentional-society-api-tests");
  });

  it("getAccount respects the account override", async () => {
    const custom: ButtondownAccount = { username: "some-other" };
    const fake = createFakeButtondownClient({ write: true, account: custom });
    expect(await fake.getAccount()).toEqual(custom);
  });

  it("listSubscribers returns a snapshot of every seeded subscriber", async () => {
    const second: ButtondownSubscriber = {
      id: "preexisting_2",
      email_address: "second@example.com",
      type: "regular",
      tags: ["other"],
    };
    const fake = createFakeButtondownClient({ write: true, initialSubscribers: [initialSub, second] });

    const list = await fake.listSubscribers();
    expect(list).toHaveLength(2);
    expect(list.map((s) => s.id).sort()).toEqual(["preexisting_1", "preexisting_2"]);
    // Returned objects are independent copies — mutating the result
    // shouldn't bleed back into the fake's store.
    list[0].tags.push("mutated-after-the-fact");
    expect((await fake.getSubscriber("preexisting_1"))?.tags).toEqual(["old-tag"]);
  });
});
