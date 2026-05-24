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

// Lifecycle state of a Buttondown subscriber. Strings come straight
// from the Buttondown API response shape. The sync only treats
// "unsubscribed" specially (don't write, raise alert); everything else
// is "subscriber exists and is reachable, do the diff."
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
};

// Identity of the API key's owning newsletter, returned by
// `GET /v1/accounts/me`. Single object, not a list — every key
// resolves to exactly one newsletter, and the username uniquely
// identifies it. Used by the test scaffolding to refuse to run
// if a key has been swapped to point at the wrong newsletter
// (the most common .env.prod accident).
export type ButtondownAccount = {
  username: string;
  email_address: string;
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

export type ButtondownClientConfig = {
  apiKey: string;
  write: boolean;
  // Override fetch for testing; defaults to the global fetch.
  fetcher?: typeof fetch;
};

export const createButtondownClient = (config: ButtondownClientConfig): ButtondownClient => {
  const fetcher = config.fetcher ?? fetch;
  // Per https://docs.buttondown.com/api-introduction the auth scheme is
  // literally the word "Token", not "Bearer".
  const authHeader = `Token ${config.apiKey}`;

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
    return (await res.json()) as ListSubscribersPage;
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
      return (await res.json()) as ButtondownAccount;
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
      return (await res.json()) as ButtondownSubscriber;
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
      return (await res.json()) as ButtondownSubscriber;
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
      return (await res.json()) as ButtondownSubscriber;
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
