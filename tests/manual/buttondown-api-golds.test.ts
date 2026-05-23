// Records Buttondown API golds against the live test newsletter.
//
// Walks the shared probe sequence (see _buttondown-probes.ts) against
// real Buttondown, writes one gold file per probe (raw HTTP +
// projected typed result) plus a meta.json stamp. The describe block
// is gated by BUTTONDOWN_TEST_API_KEY so an accidental run on a
// machine without the key no-ops rather than fails.
//
// Invoked by:  npm run special:buttondown:record-api
//
// See docs/design-buttondown.md Appendix A.

import { execSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { userInfo } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import { beforeAll, describe, expect, it } from "vitest";

import { ButtondownApiError, createButtondownClient } from "@/server/buttondown";

import { assertTestNewsletter, buildProbes, type ProbeContext, type ProbeResult } from "./_buttondown-probes";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const PROJECT_ROOT = resolve(HERE, "..", "..");
const GOLDS_DIR = resolve(
  PROJECT_ROOT,
  "tests",
  "functional",
  "server",
  "__data__",
  "buttondown",
  "golds",
);
const PROBES_DIR = resolve(GOLDS_DIR, "probes");
const META_PATH = resolve(GOLDS_DIR, "meta.json");

type RecordedHttp = {
  request: { method: string; url: string; body: unknown };
  response: { status: number; body: unknown };
};

// Wraps fetch and tags each call with the currently-active probe so
// the run can attribute multi-call probes (e.g., paginated lists) to
// the right gold file. The wrapper parses JSON bodies; non-JSON
// responses fall through as their text.
const createRecordingFetcher = () => {
  const calls = new Map<string, RecordedHttp[]>();
  let currentProbe = "";

  const setCurrentProbe = (name: string): void => {
    currentProbe = name;
  };

  const recordingFetch: typeof fetch = async (input, init) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    const method = init?.method ?? "GET";
    const reqBody = (() => {
      if (init?.body === undefined || init?.body === null) return undefined;
      if (typeof init.body !== "string") return "[non-string body]";
      try {
        return JSON.parse(init.body);
      } catch {
        return init.body;
      }
    })();

    const res = await fetch(input, init);
    const cloned = res.clone();
    const text = await cloned.text();
    const respBody = (() => {
      if (text.length === 0) return null;
      try {
        return JSON.parse(text);
      } catch {
        return text;
      }
    })();

    const entry: RecordedHttp = {
      request: { method, url, body: reqBody },
      response: { status: res.status, body: respBody },
    };
    const list = calls.get(currentProbe) ?? [];
    list.push(entry);
    calls.set(currentProbe, list);
    return res;
  };

  return { fetch: recordingFetch, setCurrentProbe, calls };
};

const keyFingerprint = (key: string): string => `${key.slice(0, 3)}...${key.slice(-3)}`;

const detectRecordedBy = (): string => {
  try {
    return execSync("git config user.email", { encoding: "utf8" }).trim();
  } catch {
    return userInfo().username;
  }
};

// Load .env.prod at module evaluation so describe.skipIf below sees
// the key if present. A missing file is fine — the describe block
// then skips and the run no-ops.
loadEnv({ path: resolve(PROJECT_ROOT, ".env.prod"), quiet: true });

describe.skipIf(!process.env.BUTTONDOWN_TEST_API_KEY)("buttondown api golds (record)", () => {
  const apiKey = process.env.BUTTONDOWN_TEST_API_KEY ?? "";
  let results: ProbeResult[];
  let httpCalls: Map<string, RecordedHttp[]>;

  beforeAll(async () => {
    const recorder = createRecordingFetcher();
    const client = createButtondownClient({ apiKey, write: true, fetcher: recorder.fetch });

    // Refuse to record if the key points at anything other than the
    // api-tests newsletter. The recorder also writes (creates and
    // deletes subscribers in the probe sequence), so the same
    // safety the seed script needs applies here.
    await assertTestNewsletter(client);

    const ctx: ProbeContext = { seededByEmail: new Map(), createdSubscriber: null };
    const out: ProbeResult[] = [];
    for (const probe of buildProbes()) {
      recorder.setCurrentProbe(probe.name);
      try {
        const raw = await probe.run(client, ctx);
        out.push({ name: probe.name, result: raw === undefined ? { __void: true } : raw });
      } catch (err) {
        if (err instanceof ButtondownApiError) {
          out.push({
            name: probe.name,
            result: { __error: { name: err.name, status: err.status, message: err.message } },
          });
        } else {
          throw err;
        }
      }
    }
    results = out;
    httpCalls = recorder.calls;

    mkdirSync(PROBES_DIR, { recursive: true });
  }, 60_000);

  it("writes one gold file per probe", () => {
    for (const probeResult of results) {
      const gold = {
        probe: probeResult.name,
        http_calls: httpCalls.get(probeResult.name) ?? [],
        typed_result: probeResult.result,
      };
      const probePath = resolve(PROBES_DIR, `${probeResult.name}.json`);
      writeFileSync(probePath, `${JSON.stringify(gold, null, 2)}\n`);
    }
    expect(results.map((r) => r.name)).toEqual(buildProbes().map((p) => p.name));
  });

  it("writes meta.json", () => {
    const meta = {
      api_version: process.env.BUTTONDOWN_TEST_API_VERSION ?? "unknown",
      key_fingerprint: keyFingerprint(apiKey),
      recorded_at: new Date().toISOString(),
      recorded_by: detectRecordedBy(),
    };
    writeFileSync(META_PATH, `${JSON.stringify(meta, null, 2)}\n`);
    const readBack = JSON.parse(readFileSync(META_PATH, "utf8")) as { key_fingerprint: string };
    expect(readBack.key_fingerprint).toBe(meta.key_fingerprint);
  });
});
