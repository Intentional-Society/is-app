import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  ButtondownApiError,
  ButtondownConflictError,
  type ButtondownSubscriber,
  createButtondownClient,
  createFakeButtondownClient,
  isDryRunOutcome,
} from "@/server/buttondown";

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

      await expect(
        client.createSubscriber({ email_address: "alice@example.com", tags: [] }),
      ).rejects.toBeInstanceOf(ButtondownConflictError);
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

  it("rejects creates whose email already exists with ButtondownConflictError", async () => {
    const fake = createFakeButtondownClient({ write: true, initialSubscribers: [initialSub] });
    await expect(
      fake.createSubscriber({ email_address: "preexisting@example.com", tags: ["x"] }),
    ).rejects.toBeInstanceOf(ButtondownConflictError);
  });

  it("overwrites the tag array on update (no merging)", async () => {
    const fake = createFakeButtondownClient({ write: true, initialSubscribers: [initialSub] });
    await fake.updateSubscriber("preexisting_1", { tags: ["completely", "different"] });
    expect((await fake.getSubscriber("preexisting_1"))?.tags).toEqual(["completely", "different"]);
  });
});
