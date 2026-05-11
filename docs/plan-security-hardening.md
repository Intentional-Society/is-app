# Plan: Security Hardening

A review of the repo, code, CI, and deployment. What we already have that's good, what's still on the list, and what's worth knowing.

---

## What's already in place

- **Drizzle parameterized queries everywhere** — no SQL-injection paths, including the raw `db.execute(sql\`...\`)` in `src/server/test-reset.ts` (uses `sql.join`, not string concatenation).
- **Allowlist on `PUT /me`** (`src/server/profiles.ts` → `parseEditableProfile`) blocks privilege escalation via `isAdmin` / `referredBy`. Backed by the regression test in `tests/functional/auth-middleware.test.ts`.
- **Atomic invite redemption** (`src/app/auth/callback/route.ts`) — single-row UPDATE with active predicates + row lock + transaction rollback. Concurrent redeemers serialise cleanly.
- **PKCE magic links**, `shouldCreateUser:false` on `/login`, `HttpOnly` cookies (Supabase SSR defaults), JSON content-type → SameSite=Lax CSRF defence holds for the API.
- **Service-role key kept out of CI** (the Phase 3a redesign was the right call).
- **Cryptographic invite codes** — `crypto.getRandomValues` with `b % 32`; alphabet length is exactly 32, so no modulo bias.
- **No real production secrets in git history.** `git log -S` for `sb_secret_`, `service_role`, `sntrys_`, prod URL patterns, and the prod project ref all come up clean. The only `sb_secret_` hit is the deterministic local-Supabase CLI key, identical on every developer's machine — not actually a secret.
- **No CORS wildcards, no open redirects** (all callback redirects use `request.url` as base).
- **Auth-middleware regression test** is a great pattern — adding a new public path must show up in a diff.
- **RLS enabled on all public tables** (PR #76) as defense-in-depth alongside the disabled Data API.
- **Sentry PII collection scrubbed** (PR #84) — `sendDefaultPii` and `includeLocalVariables` are off; `beforeSend` callbacks in `src/lib/sentry-scrub.ts` strip cookies and the `authorization` header server-side, and drop query strings on `/auth/`, `/login`, `/signup` URLs client-side. Replay uses `maskAllText: true` and `blockAllMedia: true`.
- **Security headers in place** (PR #83) — CSP (env-conditional), HSTS, `X-Frame-Options`, `Referrer-Policy`, etc. via `next.config.ts`.
- **`/logout` is POST-only** (PR #82) — `<form action="/logout" method="post">` closes the CSRF sign-out vector.
- **`/api/_test/reset` is token-gated** — `CI_RESET_TOKEN` shared-secret header is the sole gate; the destructive scope is fixed to the two seeded e2e users (`src/server/test-reset.ts`). Previously also gated on `VERCEL_ENV !== "production"`, but preview and prod share the same Supabase, so the environment gate was theatre against a token that already mutates prod data on preview runs.
- **`hono` bumped past GHSA-458j-xx4x-4375** — `npm audit` is clean.
- **Dependabot + CodeQL + secret-scanning push protection** are all configured (`.github/dependabot.yml`, `.github/workflows/codeql.yml`).
- **`SECURITY.md` + private vulnerability reporting** landed in PR #85.
- **CODEOWNERS gate on `.github/workflows/`** (`.github/CODEOWNERS`, enforced by the main-branch ruleset's `require_code_owner_review: true`) — workflow changes need an approving review from one of the listed codeowners before they can merge. Narrows the "land a tampered workflow that echoes `E2E_ADMIN_PASSWORD` / `CI_RESET_TOKEN`" path.

---

## Worth knowing, not blocking

- **`E2E_ADMIN_PASSWORD` controls a real `is_admin=true` prod account.** Blast radius from a leak is bounded — admin can revoke any invite and create/delete relation hints (`src/server/api.ts`), nothing more. Can't elevate other accounts (`parseEditableProfile` allowlist), can't read PII beyond `/members`, can't drop tables. External fork PRs can't pull the secret. Realistic vectors are: malicious npm dep exfilling env from any CI step (applies to every CI secret, not just admin), or a maintainer-account compromise. CODEOWNERS on `.github/workflows/` handles the "tampered workflow" path; the rest is accepted risk for an invite-only audience.
- **Main is protected by ruleset `15374115` ("main branch protection"), not classic protection** — `gh api .../branches/main/protection` returns 404; rulesets live at `/repos/.../rulesets`. Managed in code at `scripts/update-main-branch-protection.mjs`, applied via `npm run update_main_branch_protection`.
- **`/api/_test/reset` is registered in prod.** Intentional. Token-gated, destructive scope hard-coded to the two seeded test users (`E2E_EMAILS` in `src/server/test-reset.ts`). Preview and prod share the same Supabase, so an env-gate here would be theatre against a token that already mutates prod data on preview runs.
- **`parseEditableProfile` accepts arbitrary-length strings.** Vercel caps body at ~4.5MB so total payload is bounded; a member can still spam ~4MB strings. Quality-of-service, not security. Add `MAX_BIO=10000`, `MAX_DISPLAY_NAME=100`, etc. when convenient.
- **`sb_secret_…` in git history.** Deterministic local Supabase CLI default — not a real secret. README note + `# pragma: allowlist secret`-style annotation will keep GitGuardian / TruffleHog from filing false positives if/when the repo goes public.
- **`/api/invites/:code/check` is unauthenticated and unrate-limited.** 32¹⁰ keyspace makes brute-forcing infeasible, but high-QPS hammering can drive DB CPU. Vercel WAF / Cloudflare in front handles this cheaply if it ever shows up.
- **`displayName` flows through user-controlled `user_metadata`.** React escapes by default; just be careful that future emails or admin tooling escape it too.
- **Supabase project ref is in docs.** Already shipped to the browser via `NEXT_PUBLIC_SUPABASE_URL`, so no new exposure — just know the dashboard URL pattern is public.
- **OTP enumeration oracle** at the GoTrue layer is acknowledged in code; acceptable for an invite-only app, revisit if abuse shows up.
