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
- **`/api/_test/reset` is conditionally registered** (PR #81) — wrapped in `isResetEnabled()` so the handler does not exist in the production bundle. Token gate is the second line of defence.
- **`hono` bumped past GHSA-458j-xx4x-4375** — `npm audit` is clean.
- **Dependabot + CodeQL + secret-scanning push protection** are all configured (`.github/dependabot.yml`, `.github/workflows/codeql.yml`).

---

## Worth doing soon

### 5. `SECURITY.md` + private vulnerability reporting

In flight as PR #85 (sent back for changes — the disclosure-policy parts are right; secret-rotation runbook and admin-account threat notes need to move out of the public file into `docs/`). Once the disclosure-policy file lands, enable Settings → Code security → "Private vulnerability reporting" so the `security/advisories/new` link the file points at actually works.

### 6. `E2E_ADMIN_PASSWORD` controls a real `is_admin=true` prod account

Lives in a GH Actions secret. An attacker can study every workflow we ever write looking for an `echo`/`printenv` mistake or a malicious dep that exfils env. Two mitigations, pick one:

- Drop `e2e-admin` until we actually have admin tests; flip the flag in the seed step instead of keeping a long-lived admin account, **or**
- Restrict the e2e workflow with `permissions: read-all` and require a CODEOWNERS-gated approval on workflow file changes.

### 9. Length-limit profile fields

`parseEditableProfile` accepts arbitrary-length strings. Vercel caps body at ~4.5MB so total payload is bounded, but a member can spam ~4MB strings. Add `MAX_BIO=10000`, `MAX_DISPLAY_NAME=100`, etc.

### 11. Document the `sb_secret_…` in git history

Any `sb_secret_…` token in this repo is the deterministic local Supabase CLI default — not a real secret. Add a README note and a `# pragma: allowlist secret`-style annotation where it appears, so GitGuardian / TruffleHog don't open issues against the public repo.

---

## Worth knowing, not blocking

- **`/api/invites/:code/check` is unauthenticated and unrate-limited.** 32¹⁰ keyspace makes brute-forcing infeasible, but high-QPS hammering can drive DB CPU. Vercel WAF / Cloudflare in front handles this cheaply if it ever shows up.
- **`displayName` flows through user-controlled `user_metadata`.** React escapes by default; just be careful that future emails or admin tooling escape it too.
- **Supabase project ref is in docs.** Already shipped to the browser via `NEXT_PUBLIC_SUPABASE_URL`, so no new exposure — just know the dashboard URL pattern is public.
- **OTP enumeration oracle** at the GoTrue layer is acknowledged in code; acceptable for an invite-only app, revisit if abuse shows up.

---

## Suggested landing order

1. **Item 5** (`SECURITY.md` revisions + enable PVR) — needed before first outside contact; the advisory link is currently dead.
2. **Item 6** (`E2E_ADMIN_PASSWORD`) — pick a mitigation; an attacker reading workflows is a realistic threat now that the repo is public.
3. **Item 11** (document `sb_secret_…`) — cheap, prevents false-positive scanner noise.
4. **Item 9** (length limits) — quality-of-service, lower urgency than the others.

Items from "worth knowing, not blocking" can ship whenever the underlying surface changes.
