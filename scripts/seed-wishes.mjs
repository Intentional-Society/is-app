#!/usr/bin/env node
// Seeds sample wishes for the dev dummy profiles. Idempotent — skips
// any profile that already has wishes. Run with: node scripts/seed-wishes.mjs

import { config } from "dotenv";
import postgres from "postgres";

config({ path: ".env.local", quiet: true });

const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) {
  process.stderr.write("seed-wishes: DATABASE_URL is required\n");
  process.exit(1);
}

// Safety: local only.
let host;
try {
  host = new URL(dbUrl).hostname;
} catch {
  host = "(unparseable)";
}
if (host !== "127.0.0.1" && host !== "localhost") {
  process.stderr.write(`seed-wishes: DATABASE_URL points at ${host}; refusing to seed a non-local DB\n`);
  process.exit(1);
}

const sql = postgres(dbUrl, { max: 1, onnotice: () => {} });

// Wishes per profile — keyed by fixed dev profile UUID.
const WISHES = {
  "00000000-0000-0000-0000-000000000001": [
    {
      title: "To be genuinely helpful without losing myself",
      description:
        "I keep noticing a tension between full presence for others and staying grounded in myself. I'd like to find a way that doesn't require choosing.",
    },
    {
      title: "A depth practice that sustains me through years, not just seasons",
      description: null,
    },
    {
      title: "More spaces where the practical and the profound coexist",
      description: "So much of what I do splits these two. I want to stop splitting them.",
    },
  ],
  "00000000-0000-0000-0000-000000000002": [
    {
      title: "To witness a group slow down at a genuinely critical moment, and trust it",
      description:
        "I've seen groups speed up when things get hard. I want to see one choose slowness deliberately — and be right.",
    },
    {
      title: "More time living close to the land",
      description: null,
    },
  ],
  "00000000-0000-0000-0000-000000000003": [
    {
      title: "Learning spaces that nourish rather than extract",
      description: "I want to build programs where participants leave more themselves, not less.",
    },
    {
      title: "To be part of something that outlasts me in a good way",
      description: null,
    },
    {
      title: "Understanding what changes when people feel genuinely seen",
      description:
        "I keep observing this shift happen and I want to understand it better so I can help it happen more reliably.",
    },
  ],
  "00000000-0000-0000-0000-000000000004": [
    {
      title: "To finally name what most professional development spaces are missing",
      description:
        "I've been circling this for years. Something about interiority, about the space between stimulus and response.",
    },
    {
      title: "A therapy practice that makes room for the philosophical",
      description: null,
    },
  ],
  "00000000-0000-0000-0000-000000000005": [
    {
      title: "Stillness that doesn't require retreat from the world",
      description:
        "I love retreats, but I want stillness to be available on a Tuesday afternoon in the middle of everything.",
    },
    {
      title: "To build technology that respects the limits of attention",
      description: "I know what I'm complicit in. I want to build differently.",
    },
    {
      title: "A contemplative community that takes practice seriously",
      description: null,
    },
  ],
  "00000000-0000-0000-0000-000000000006": [
    {
      title: "Spaces safe enough for real things to be said",
      description:
        "Not just psychologically safe — genuinely safe. Where the act of saying something true doesn't cost too much.",
    },
    {
      title: "A piece of furniture made entirely for someone I love",
      description: "Something I take a long time with, without rushing.",
    },
  ],
  "00000000-0000-0000-0000-000000000007": [
    {
      title: "Stories that help people locate themselves across cultures",
      description:
        "I grew up between places and I know how disorienting that can be. I want to write things that make it feel less lonely.",
    },
    {
      title: "To remember my grandmother's voice clearly",
      description: null,
    },
    {
      title: "A classroom that leaves room for not-knowing",
      description: "Most classrooms are designed to eliminate uncertainty. I want one designed around it.",
    },
  ],
  "00000000-0000-0000-0000-000000000008": [
    {
      title: "A garden that changes how visitors move through time",
      description:
        "I want to design a space where people naturally slow down and become present, without being told to.",
    },
    {
      title: "More slow conversations, fewer fast networks",
      description: null,
    },
  ],
  "00000000-0000-0000-0000-000000000009": [
    {
      title: "Care infrastructure that doesn't burn out the carers",
      description:
        "This is both a professional and a personal wish. The systems I work with consume the people trying to hold them.",
    },
    {
      title: "To understand what communities owe each other at scale",
      description:
        "Women's circles have taught me something about mutual obligation. I want to understand if it translates.",
    },
    {
      title: "More cross-cultural conversations about grief and healing",
      description: null,
    },
  ],
};

try {
  let seeded = 0;
  let skipped = 0;

  for (const [profileId, wishes] of Object.entries(WISHES)) {
    // Check if profile exists.
    const [profile] = await sql`SELECT id FROM profiles WHERE id = ${profileId}`;
    if (!profile) {
      process.stdout.write(`  skip ${profileId} — profile not found\n`);
      skipped++;
      continue;
    }

    // Check if already has wishes.
    const [existing] = await sql`SELECT id FROM wishes WHERE author_id = ${profileId} LIMIT 1`;
    if (existing) {
      process.stdout.write(`  skip ${profileId} — already has wishes\n`);
      skipped++;
      continue;
    }

    for (const wish of wishes) {
      await sql`
        INSERT INTO wishes (author_id, title, description, status)
        VALUES (${profileId}, ${wish.title}, ${wish.description}, 'active')
      `;
    }
    process.stdout.write(`  seeded ${wishes.length} wishes for ${profileId}\n`);
    seeded++;
  }

  process.stdout.write(`\ndone: seeded ${seeded} profiles, skipped ${skipped}\n`);
} finally {
  await sql.end();
}
