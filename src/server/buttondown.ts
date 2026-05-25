// Buttondown API client.
//
// See docs/design-buttondown.md for the integration design and
// https://docs.buttondown.com/api-introduction for the API itself.
//
// The client deliberately has a small surface: read one subscriber
// (by id or email), create one, update one. Tag and email writes both
// flow through updateSubscriber — a PATCH with `tags` does a full
// overwrite of the tag array, which is exactly what the sync's
// authoritative first-profile-save path wants.
//
// The write-vs-dry-run gate lives at this layer: the client is
// constructed with `write: boolean` and every mutation method either
// performs the real call (write=true) or returns a DryRunOutcome
// describing what it would have done (write=false). Reads are not
// gated — they only inform decisions and never change Buttondown
// state.

const BUTTONDOWN_BASE_URL = "https://api.buttondown.com/v1";

// Lifecycle state of a Buttondown subscriber: regular (active),
// premium (paid), unactivated (pending confirmation), unsubscribed,
// removed.
export type ButtondownSubscriberType = "regular" | "premium" | "unactivated" | "unsubscribed" | "removed";

// Minimal projection of the subscriber object — only the fields the
// sync reads. The API returns more, all ignored by us.
export type ButtondownSubscriber = {
  id: string;
  email_address: string;
  type: ButtondownSubscriberType;
  tags: string[];
};

export type CreateSubscriberInput = {
  email_address: string;
  tags: string[];
  // Buttondown's default behavior on POST /subscribers is to send a
  // double-opt-in confirmation email. Pass "regular" to bypass that
  // when the caller can vouch for the email — which is everywhere we
  // create subscribers (program membership is the consent act). See
  // docs.buttondown.com — "API-driven subscriber creation."
  type?: ButtondownSubscriberType;
};

export type UpdateSubscriberInput = {
  tags?: string[];
  email_address?: string;
  type?: ButtondownSubscriberType;
};

// Identity of the API key's owning newsletter, returned by
// `GET /v1/accounts/me`. Single object, not a list — every key
// resolves to exactly one newsletter, and the username uniquely
// identifies it. Used by the test scaffolding to refuse to run
// if a key has been swapped to point at the wrong newsletter
// (the most common .env.prod accident).
export type ButtondownAccount = {
  username: string;
};

// Sentinel returned from mutation methods when the client is in
// dry-run mode. Carries the payload that would have been sent so the
// caller can log a faithful "would have done X" record without a
// separate code path.
export type DryRunOutcome<T extends "create" | "update" | "delete"> = T extends "create"
  ? { dryRun: true; intent: "create"; payload: CreateSubscriberInput }
  : T extends "update"
    ? { dryRun: true; intent: "update"; payload: { id: string; patch: UpdateSubscriberInput } }
    : { dryRun: true; intent: "delete"; payload: { id: string } };

export const isDryRunOutcome = <T extends "create" | "update" | "delete">(
  result: ButtondownSubscriber | undefined | DryRunOutcome<T>,
): result is DryRunOutcome<T> =>
  typeof result === "object" && result !== null && "dryRun" in result && result.dryRun === true;

export class ButtondownApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "ButtondownApiError";
  }
}

// Thrown by createSubscriber when the email is already on the audience.
// The sync interprets this as "fall through to update by email" — the
// person predates the app's record of them and we need to PATCH, not
// POST. Per the Buttondown docs, duplicate POSTs are rejected by default.
export class ButtondownConflictError extends ButtondownApiError {
  constructor() {
    super(409, "Subscriber with this email already exists");
    this.name = "ButtondownConflictError";
  }
}

// Shape of one page of the list endpoint's response. `next` is a
// full URL to the next page or null on the last page.
type ListSubscribersPage = {
  results: ButtondownSubscriber[];
  next: string | null;
};

// Runtime projection from a parsed JSON response to the typed
// shapes our client exposes. The Buttondown API returns many more
// fields than we declare (creation_date, secondary_id, notes,
// metadata, source, utm_*, etc.); without this projection the
// runtime value would carry them all even though the static type
// only admits four. That mismatch leaks into the fake-vs-real
// comparison — the fake stores 4-field subscribers, the real
// client otherwise returns 15+ — so projecting at the client
// boundary is what lets the replay deep-equal pass.
const projectSubscriber = (raw: unknown): ButtondownSubscriber => {
  const obj = raw as Record<string, unknown>;
  return {
    id: obj.id as string,
    email_address: obj.email_address as string,
    type: obj.type as ButtondownSubscriberType,
    tags: obj.tags as string[],
  };
};

const projectAccount = (raw: unknown): ButtondownAccount => {
  const obj = raw as Record<string, unknown>;
  return {
    username: obj.username as string,
  };
};

export interface ButtondownClient {
  /**
   * Fetch every subscriber, following Buttondown's cursor pagination
   * (`next` URLs) until exhausted. Returns a flat array; intended for
   * the daily reconciler and the bootstrap script so they can do one
   * paginated round-trip and then iterate profiles against a local map
   * instead of doing one GET per profile.
   */
  listSubscribers(): Promise<ButtondownSubscriber[]>;
  /**
   * Identify the key's owning newsletter. `GET /v1/accounts/me`
   * returns a single object with the newsletter's username and the
   * owner's email. Used by the test scaffolding to refuse to run
   * if the key has been swapped.
   */
  getAccount(): Promise<ButtondownAccount>;
  /**
   * Single-shot lookup by id or email. Returns null on 404. Used by
   * the inline first-profile-save hook, where pre-listing the whole
   * audience would be wasteful.
   */
  getSubscriber(idOrEmail: string): Promise<ButtondownSubscriber | null>;
  /** Throws ButtondownConflictError on 409 (duplicate email). */
  createSubscriber(input: CreateSubscriberInput): Promise<ButtondownSubscriber | DryRunOutcome<"create">>;
  updateSubscriber(id: string, patch: UpdateSubscriberInput): Promise<ButtondownSubscriber | DryRunOutcome<"update">>;
  /**
   * Delete a subscriber by id. The cron and inline paths never call
   * this — it exists for the manual probe sequence and for the
   * seed-fixtures script's empty-then-seed cycle. Returns void on
   * success; throws on 404 or other non-2xx.
   */
  deleteSubscriber(id: string): Promise<undefined | DryRunOutcome<"delete">>;
}

/**
 * One log line per HTTP call. Emitted from the client whenever a
 * `logger` is provided in the config — that gives the runner a place
 * to forward this into Axiom without coupling the client to next-axiom.
 * `path` is the path portion only (no query string, no host), so an
 * Axiom panel can group by it.
 */
export type ButtondownHttpLogEvent = {
  method: string;
  path: string;
  status: number;
  durationMs: number;
  // Present on 429s when Buttondown returns the standard hint.
  retryAfter?: string;
};

export type ButtondownClientConfig = {
  apiKey: string;
  write: boolean;
  // Override fetch for testing; defaults to the global fetch.
  fetcher?: typeof fetch;
  // Optional per-request telemetry sink. Constructed by the runner
  // for prod paths; tests typically leave it unset.
  logger?: (event: ButtondownHttpLogEvent) => void;
};

export const createButtondownClient = (config: ButtondownClientConfig): ButtondownClient => {
  const rawFetcher = config.fetcher ?? fetch;
  // Per https://docs.buttondown.com/api-introduction the auth scheme is
  // literally the word "Token", not "Bearer".
  const authHeader = `Token ${config.apiKey}`;
  const logger = config.logger;

  // Wrap every outbound call with timing + status logging. The base
  // URL is constant, so logging the path alone is enough to group by
  // endpoint in Axiom. `next` URLs from pagination are absolute, so
  // we strip the base before logging when we can.
  const fetcher: typeof fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const method = init?.method ?? (typeof input === "object" && "method" in input ? input.method : "GET");
    // Defense-in-depth: pagination follows `next` URLs returned by
    // Buttondown's response body. Refuse to forward our Authorization
    // header to anything outside Buttondown's API in case that field
    // ever points elsewhere.
    if (!url.startsWith(BUTTONDOWN_BASE_URL)) {
      throw new ButtondownApiError(0, `Refusing to fetch URL outside Buttondown: ${url}`);
    }
    const path = url.slice(BUTTONDOWN_BASE_URL.length);
    const start = Date.now();
    const res = await rawFetcher(input, init);
    if (logger) {
      const event: ButtondownHttpLogEvent = {
        method,
        path,
        status: res.status,
        durationMs: Date.now() - start,
      };
      if (res.status === 429) {
        const retryAfter = res.headers.get("retry-after");
        if (retryAfter !== null) event.retryAfter = retryAfter;
      }
      logger(event);
    }
    return res;
  };

  const request = async (method: string, path: string, body?: unknown): Promise<Response> => {
    return fetcher(`${BUTTONDOWN_BASE_URL}${path}`, {
      method,
      headers: {
        Authorization: authHeader,
        "content-type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  };

  // Helper for paginated GETs that follow `next` URLs. `next` from
  // Buttondown's API comes back as a full absolute URL, so we use it
  // directly instead of reconstructing from a cursor; once null, the
  // pagination is done. The `Authorization` header carries forward on
  // each hop because we route through the same `request` shape.
  const fetchPage = async (url: string): Promise<ListSubscribersPage> => {
    // `url` is either a full Buttondown URL (from a `next` link) or a
    // relative path on the first call.
    const fullUrl = url.startsWith("http") ? url : `${BUTTONDOWN_BASE_URL}${url}`;
    const res = await fetcher(fullUrl, {
      method: "GET",
      headers: { Authorization: authHeader, "content-type": "application/json" },
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new ButtondownApiError(res.status, `GET subscribers: ${res.status} ${detail}`);
    }
    const raw = (await res.json()) as { results: unknown[]; next: string | null };
    return { results: raw.results.map(projectSubscriber), next: raw.next };
  };

  return {
    async listSubscribers() {
      const all: ButtondownSubscriber[] = [];
      let next: string | null = "/subscribers";
      while (next !== null) {
        const page = await fetchPage(next);
        all.push(...page.results);
        next = page.next;
      }
      return all;
    },

    async getAccount() {
      const res = await request("GET", "/accounts/me");
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new ButtondownApiError(res.status, `GET account: ${res.status} ${detail}`);
      }
      return projectAccount(await res.json());
    },

    async getSubscriber(idOrEmail) {
      // The endpoint accepts either id or email at the same slot; we
      // URL-encode either way so the "+" and "/" that can appear in
      // emails don't break routing.
      const res = await request("GET", `/subscribers/${encodeURIComponent(idOrEmail)}`);
      if (res.status === 404) return null;
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new ButtondownApiError(res.status, `GET subscriber: ${res.status} ${detail}`);
      }
      return projectSubscriber(await res.json());
    },

    async createSubscriber(input) {
      if (!config.write) {
        return { dryRun: true, intent: "create", payload: input };
      }
      const res = await request("POST", "/subscribers", input);
      if (res.status === 409) throw new ButtondownConflictError();
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new ButtondownApiError(res.status, `POST subscriber: ${res.status} ${detail}`);
      }
      return projectSubscriber(await res.json());
    },

    async updateSubscriber(id, patch) {
      if (!config.write) {
        return { dryRun: true, intent: "update", payload: { id, patch } };
      }
      const res = await request("PATCH", `/subscribers/${encodeURIComponent(id)}`, patch);
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new ButtondownApiError(res.status, `PATCH subscriber: ${res.status} ${detail}`);
      }
      return projectSubscriber(await res.json());
    },

    async deleteSubscriber(id) {
      if (!config.write) {
        return { dryRun: true, intent: "delete", payload: { id } };
      }
      const res = await request("DELETE", `/subscribers/${encodeURIComponent(id)}`);
      // 204 No Content is the documented success shape; tolerate any
      // 2xx for forward-compatibility.
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new ButtondownApiError(res.status, `DELETE subscriber: ${res.status} ${detail}`);
      }
    },
  };
};

// The in-memory fake client used by the test suite lives at
// tests/functional/server/buttondown-fake.ts so test-only code stays
// outside the src/ tree.
