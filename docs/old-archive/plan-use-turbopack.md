# Plan: Switch dev server to Turbopack

## Goal

Eliminate a recurring Windows-only dev-server crash by swapping `next dev`
for `next dev --turbopack`. Stop relying on `rm -rf .next` as the workaround.

## What is Turbopack?

Turbopack is Vercel's Rust-based bundler, built as the eventual successor
to webpack inside Next.js. It's the thing that compiles your TypeScript
and React into runnable JS, watches files, and serves the HMR updates
that make the dev server feel live. Same job webpack does — different
implementation.

Two things make it relevant here:

1. **It's written in Rust** and parallelizes aggressively, so cold starts
   and incremental rebuilds are noticeably faster.
2. **Its cache is content-addressed in memory and on disk differently**
   from webpack's `PackFileCacheStrategy`. No `*.pack.gz_` → `*.pack.gz`
   rename dance — which is the specific Windows race we're trying to
   escape.

Status inside Next.js: stable for `next dev` in Next 15, on track to
become the default in Next 16. Production `next build` is still webpack
for now; Turbopack build support exists but is beta.

Using it is a one-flag change (`--turbopack`). No new dependencies, no
config migration, no lockfile churn.

## Pros and cons of switching

**Pros**
- Fixes the `installChunk` crash we keep hitting on Windows.
- Faster dev startup and HMR (a few-second-per-change improvement, not
  life-changing but real).
- Aligns with Next.js's direction — less work when Next 16 lands.

**Cons**
- Sentry can't auto-instrument server actions under Turbopack yet. We
  have one (sign-out); it's trivial.
- Surfaces noisy `import-in-the-middle` version warnings from Sentry's
  transitive OTel deps. Non-fatal, just ugly.
- Teammate who hits a Turbopack-specific bug would need to drop the
  flag locally until fixed.

## Symptom

After any interrupted dev run (Ctrl+C, VS Code restart, antivirus touch),
the next `npm run dev` would compile fine on first load but crash on a
subsequent route with:

```
TypeError: Cannot read properties of undefined (reading 'length')
    at installChunk (.next/server/webpack-runtime.js:…)
```

Most recently reproduced hitting `/auth/callback` during Phase 2 testing.
Manually deleting `.next/` made the error go away — until the next
interrupted run recreated a bad pack file.

## Root cause

Webpack's `PackFileCacheStrategy` writes pack files as `*.pack.gz_`
and renames them to `*.pack.gz` on success. On Windows this rename
races with antivirus scanning, file-indexing services, and any lingering
file handles from the previous dev process. A lost race leaves either
a truncated `.pack.gz` or a leftover `.pack.gz_`. On the next load,
webpack deserializes the bad pack as `undefined` and its runtime chunk
loader blows up dereferencing it.

This is a longstanding, still-unresolved Next.js issue on Windows. It
is not caused by anything in our code.

## Why Turbopack fixes it

Turbopack is Next.js's Rust-based bundler, stable for `next dev` in
Next 15 and slated to become the default in Next 16. Its cache is
built differently — there is no `PackFileCacheStrategy`, no rename
race, and nothing on disk that deserializes to `undefined`. Empirically
the `installChunk` crash disappears. Functionally it also starts faster
and incremental-rebuilds faster, but those are bonuses — the motivation
here is correctness, not speed.

## Compatibility

Our stack already supports Turbopack with zero config changes:

- **Next 15.5.15** — Turbopack is stable for `dev`.
- **@sentry/nextjs 10.47.0** — full Turbopack support landed in Next
  15.4.1+. Our `withSentryConfig` call uses none of the webpack-only
  options (`autoInstrumentServerFunctions`, `autoInstrumentMiddleware`,
  `excludeServerRoutes`).
- **Tailwind v4 / PostCSS** — supported.
- **Production `next build`** — stays on webpack. No change to Vercel
  deploys, migrations, or bundles.

## Known trade-offs

1. **Server actions lose auto-instrumentation.** Sentry's webpack plugin
   auto-wraps server actions; Turbopack doesn't yet. We have one simple
   server action (sign-out); acceptable.
2. **Noisy warnings.** Turbopack surfaces `import-in-the-middle`
   version-mismatch warnings from `@fastify/otel` and
   `@prisma/instrumentation` (both are transitive OTel deps pulled in
   by Sentry). They are non-fatal, well-known, and expected to quiet
   in Next 16. We accept the noise.

## Change

One line in `package.json`:

```diff
-    "dev": "npm run dev:db && next dev",
+    "dev": "npm run dev:db && next dev --turbopack",
```

## Verification

- `npm test` — all 21 functional + 5 e2e pass (e2e drives `next dev`
  via Playwright's webServer, which picks up the new flag).
- Manual smoke: `/login`, `/auth/callback`, `/welcome`, `/` all load
  under Turbopack with no runtime errors.

## Rollback

If Turbopack misbehaves on a teammate's machine, `next dev` (webpack)
still works — just drop the `--turbopack` flag locally. Production is
unaffected either way.

## Devjournal entry to post on commit

```
## 2026-04-19 | James | Switched dev server to Turbopack

`npm run dev` now runs `next dev --turbopack`. The motivation was a
recurring Windows-only crash: `TypeError: Cannot read properties of
undefined (reading 'length')` at `installChunk` in
`.next/server/webpack-runtime.js`, reliably reproducible after any
interrupted dev run. Root cause is webpack's `PackFileCacheStrategy`
rename race on Windows — it writes `*.pack.gz_` and renames to
`*.pack.gz`, and the rename loses to antivirus / file-lock interference,
leaving a half-written pack that later deserializes as `undefined`.
This is a longstanding unresolved Next.js issue, and the only reliable
mitigation under webpack was `rm -rf .next` — not a long-term answer.

Turbopack has its own cache architecture and sidesteps the race
entirely. Our stack already supports it: Next 15.5.15 ships Turbopack
as stable for `dev`, and `@sentry/nextjs` 10.47.0 has full Turbopack
support on Next 15.4.1+. Our Sentry config uses none of the webpack-only
options (`autoInstrumentServerFunctions`, `autoInstrumentMiddleware`,
`excludeServerRoutes`), so no config changes were required. The one
known trade-off — server actions lose auto-instrumentation — is
negligible for us (one simple sign-out action). Production `next build`
is unaffected; still webpack, still migrated on deploy.

Turbopack surfaces noisy `import-in-the-middle` version-mismatch
warnings from `@fastify/otel` and `@prisma/instrumentation` (transitive
OTel deps via Sentry). They're non-fatal and well-known; Next 16 is
expected to quiet them.
```
