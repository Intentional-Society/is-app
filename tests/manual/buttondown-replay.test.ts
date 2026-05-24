// Replays the Buttondown probe sequence against the in-memory fake
// and asserts the resulting typed sequence matches the recorded
// golds (after id-normalization).
//
// Run via:  npm run test:manual:buttondown-api-replay
//
// See docs/design-buttondown.md Appendix A for the design.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import type { ButtondownSubscriber } from "@/server/buttondown";

import { createFakeButtondownClient } from "../functional/server/buttondown-fake";
import { buildProbes, runProbeSequence, type ProbeResult } from "./_buttondown-probes";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const PROJECT_ROOT = resolve(HERE, "..", "..");
const DATA_ROOT = resolve(
  PROJECT_ROOT,
  "tests",
  "functional",
  "server",
  "__data__",
  "buttondown",
);
const SEED_PATH = resolve(DATA_ROOT, "fixtures", "seed.json");
const GOLDS_DIR = resolve(DATA_ROOT, "golds");

type SeedEntry = { email_address: string; tags: string[]; unsubscribed?: true };

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

// Replaces every Buttondown-assigned id with a stable, email-keyed
// placeholder, so a sequence recorded against the real API and a
// sequence produced by the fake (which mints its own ids) compare
// equal. Also sorts subscriber-shaped arrays by email so list
// ordering doesn't leak into the assertion.
//
// First pass collects (id, email_address) pairs from every
// subscriber-shaped object anywhere in the tree. Second pass round-
// trips through JSON to do a single string replace per id — covers
// ids in nested objects, error messages, and anywhere else they
// might appear. Third pass sorts subscriber arrays in place.
const normalizeSequence = (sequence: ProbeResult[]): ProbeResult[] => {
  const idToEmail = new Map<string, string>();

  const collect = (val: unknown): void => {
    if (val === null || typeof val !== "object") return;
    if (Array.isArray(val)) {
      for (const item of val) collect(item);
      return;
    }
    const obj = val as Record<string, unknown>;
    if (typeof obj.id === "string" && typeof obj.email_address === "string") {
      idToEmail.set(obj.id, obj.email_address.toLowerCase());
    }
    for (const v of Object.values(obj)) collect(v);
  };
  for (const probe of sequence) collect(probe.result);

  let json = JSON.stringify(sequence);
  // Longest ids first so a short id that's a prefix of a longer one
  // can't grab the longer one's replacement.
  const ids = [...idToEmail.keys()].sort((a, b) => b.length - a.length);
  for (const id of ids) {
    const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    json = json.replace(new RegExp(escaped, "g"), `<<id-for:${idToEmail.get(id)}>>`);
  }
  const stripped = JSON.parse(json) as ProbeResult[];

  const sortSubscriberArrays = (val: unknown): unknown => {
    if (val === null || typeof val !== "object") return val;
    if (Array.isArray(val)) {
      const isSubscriberArray = val.every(
        (v) => v !== null && typeof v === "object" && typeof (v as Record<string, unknown>).email_address === "string",
      );
      const mapped = val.map(sortSubscriberArrays);
      if (isSubscriberArray) {
        return [...mapped].sort((a, b) =>
          ((a as Record<string, unknown>).email_address as string).localeCompare(
            (b as Record<string, unknown>).email_address as string,
          ),
        );
      }
      return mapped;
    }
    const obj = val as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) out[k] = sortSubscriberArrays(v);
    return out;
  };
  return sortSubscriberArrays(stripped) as ProbeResult[];
};

// ---------------------------------------------------------------------------
// Replay test
// ---------------------------------------------------------------------------

const loadGolds = (): ProbeResult[] => {
  return buildProbes().map((probe) => {
    const goldPath = resolve(GOLDS_DIR, `${probe.name}.json`);
    const raw = JSON.parse(readFileSync(goldPath, "utf8")) as { typed_result: unknown };
    return { name: probe.name, result: raw.typed_result };
  });
};

const loadSeed = (): ButtondownSubscriber[] => {
  const entries = JSON.parse(readFileSync(SEED_PATH, "utf8")) as SeedEntry[];
  return entries.map((entry, i) => ({
    id: `fake-seed-${i + 1}`,
    email_address: entry.email_address,
    type: entry.unsubscribed === true ? ("unsubscribed" as const) : ("regular" as const),
    tags: [...entry.tags],
  }));
};

describe("buttondown replay", () => {
  it("fake's probe sequence matches the recorded golds after id-normalization", async () => {
    const fake = createFakeButtondownClient({ write: true, initialSubscribers: loadSeed() });
    const fakeResults = await runProbeSequence(fake);
    const goldResults = loadGolds();
    expect(normalizeSequence(fakeResults)).toEqual(normalizeSequence(goldResults));
  });
});
