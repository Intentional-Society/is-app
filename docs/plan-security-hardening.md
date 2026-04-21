# Plan: Security Hardening (pre-public-repo)

A review of the repo, code, CI, and deployment ahead of flipping the GitHub repository to public. What we already have that's good, what to fix before going public, and what's worth knowing.

---

## What's already in place

- **Drizzle parameterized queries everywhere** — no SQL-injection paths, including the raw `db.execute(sql\`...\`)` in `src/server/test-reset.ts` (uses `sql.join`, not string concatenation).
- **Allowlist on `PUT /me`** (`src/server/profiles.ts` → `parseEditableProfile`) blocks privilege escalation via `isAdmin` / `referredBy`. Backed by the regression test in `tests/functional/auth-middleware.test.ts`.
- **Atomic invite redemption** (`src/app/auth/callback/route.ts`) — single-row UPDATE with active predicates + row lock + transaction rollback. Concurrent redeemers serialise cleanly.
- **PKCE magic links**, `shouldCreateUser:false` on `/login`, `HttpOnly` cookies (Supabase SSR defaults), JSON content-type → SameSite=Lax CSRF defence holds for the API.
- **Service-role key kept out of CI** (the Phase 3a redesign was the right call).
- **Cryptographic invite codes** — `crypto.getRandomValues` with `b % 32`; alphabet length is exactly 32, so no modulo bias. (Nit: the comment in `src/server/invites.ts` says "23 letters / 31 chars" but it's 24/32. Math is correct, comment is off-by-one — worth a drive-by fix.)
- **No real production secrets in git history.** `git log -S` for `sb_secret_`, `service_role`, `sntrys_`, prod URL patterns, and the prod project ref all come up clean. The only `sb_secret_` hit is the deterministic local-Supabase CLI key, identical on every developer's machine — not actually a secret.
- **No CORS wildcards, no open redirects** (all callback redirects use `request.url` as base).
- **Auth-middleware regression test** is a great pattern — adding a new public path must show up in a diff.

---

## Fix before going public

### 1. Sentry is over-collecting PII

`instrumentation-client.ts` and `sentry.server.config.ts` both set `sendDefaultPii: true`. Combined with `replaysOnErrorSampleRate: 1.0` (client) and `includeLocalVariables: true` (server), Sentry receives:

- All request headers + cookies (auth cookies are HttpOnly so client JS can't read them, but the server config sees them all)
- Full request bodies including `bio`, `liveDesire`, `emergencyContact`, `supplementaryInfo` — exactly the disclosures members trusted us with
- DOM snapshots via Replay; the default masks `<input>` values but **does not mask `<textarea>` content** unless `maskAllText: true` is set. Our bio/liveDesire/supplementaryInfo textareas are captured verbatim
- Local function variables in server stack traces (raw user objects, profile rows)

Members did not consent to a third party (Sentry) seeing this. Once the repo is public an attacker can read these settings and craft scenarios that intentionally throw to trigger captures.

**Fix:** drop `sendDefaultPii`, drop `includeLocalVariables`, and pass `replayIntegration({ maskAllText: true, blockAllMedia: true })` — or scope Replay to only the marketing/login surface, not authenticated pages.

### 2. Magic-link `?code=...` URLs in Sentry Replay

Same root cause as #1. PKCE means the code alone isn't full ATO (verifier lives in localStorage), but Replay events also capture localStorage. With `sendDefaultPii: true` we're one error away from sending a usable session-establishment kit to a third party. Disable Replay on `/auth/callback` explicitly.

### 3. Bump `hono` past GHSA-458j-xx4x-4375

`npm audit` flags `hono@4.12.10` (moderate — HTML injection via JSX SSR). We don't use Hono's JSX so we're probably not exploitable, but a public-repo vuln scanner will alarm on day one. `npm install hono@^4.12.14`.

### 4. Enable Dependabot + CodeQL + GitHub secret-scanning push protection

All three are free for public repos. Add `.github/dependabot.yml` and `.github/workflows/codeql.yml` *before* flipping public — the first dependency CVE that lands silently is much worse than the noise of weekly Dependabot PRs. Push protection is a repo-settings toggle.

### 5. Add a `SECURITY.md` and turn on private vulnerability reporting

Public repos attract reports; we want a documented intake instead of researchers tweeting findings. Settings → Security → "Private vulnerability reporting" is one click.

---

## Worth doing soon

### 6. `E2E_ADMIN_PASSWORD` controls a real `is_admin=true` prod account

Lives in a GH Actions secret. On a public repo, an attacker can study every workflow we'll ever write looking for an `echo`/`printenv` mistake or a malicious dep that exfils env. Two mitigations, pick one:

- Drop `e2e-admin` until we actually have admin tests; flip the flag in the seed step instead of keeping a long-lived admin account, **or**
- Restrict the e2e workflow with `permissions: read-all` and require a CODEOWNERS-gated approval on workflow file changes.

### 7. `/api/_test/reset` is reachable on previews

The token + `VERCEL_ENV` gates are correct, but going public publishes the endpoint name and gating logic. Belt-and-braces fix: register the route conditionally so it doesn't even exist in the production bundle:

```ts
if (process.env.VERCEL_ENV !== "production") {
  api.post("/_test/reset", ...)
}
```

Then a token leak literally cannot hit a handler that doesn't exist.

### 8. Security headers

No CSP, no HSTS, no `X-Frame-Options`, no `Referrer-Policy` anywhere. Next.js `headers()` config or `vercel.json`'s `headers` block — ~15 lines. CSP is the high-value one; it neuters XSS even if React's escaping ever fails (e.g. a `dangerouslySetInnerHTML` introduced by a future change).

### 9. Length-limit profile fields

`parseEditableProfile` accepts arbitrary-length strings. Vercel caps body at ~4.5MB so total payload is bounded, but a member can spam ~4MB strings. Add `MAX_BIO=10000`, `MAX_DISPLAY_NAME=100`, etc.

### 10. `/logout` GET → POST

Acknowledged in the comment, but on a public repo we'll get drive-by reports. A `<form action="/logout" method="post">` button is the same UX with zero CSRF surface.

### 11. Document the `sb_secret_…` in git history

Any `sb_secret_…` token in this repo is the deterministic local Supabase CLI default — not a real secret. Add a README note and a `# pragma: allowlist secret`-style annotation where it appears, so GitGuardian / TruffleHog don't open issues the day we go public.

---

## Worth knowing, not blocking

- **`/api/invites/:code/check` is unauthenticated and unrate-limited.** 32¹⁰ keyspace makes brute-forcing infeasible, but high-QPS hammering can drive DB CPU. Vercel WAF / Cloudflare in front handles this cheaply if it ever shows up.
- **`displayName` flows through user-controlled `user_metadata`.** React escapes by default; just be careful that future emails or admin tooling escape it too.
- **Supabase project ref is in docs.** Already shipped to the browser via `NEXT_PUBLIC_SUPABASE_URL`, so no new exposure — just know the dashboard URL pattern is now public.
- **OTP enumeration oracle** at the GoTrue layer is acknowledged in code; acceptable for an invite-only app, revisit if abuse shows up.

---

## Suggested landing order

1. **Item 4** (Dependabot + CodeQL + secret-scanning) — ground the repo in good hygiene first, so subsequent PRs get scanned.
2. **Item 3** (hono bump) — quick win, clears `npm audit`.
3. **Item 1 + 2** (Sentry PII + Replay scope) — highest privacy impact, small diff.
4. **Item 5** (`SECURITY.md` + private vuln reporting) — needed before first outside contact.
5. **Items 7, 8, 10, 11** — hardening, can bundle.
6. **Items 6, 9** — medium-priority follow-ups.

Items from "worth knowing, not blocking" can ship whenever the underlying surface changes.
