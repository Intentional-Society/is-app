# Security Policy

## Reporting a Vulnerability

Please **do not** open a public GitHub issue for security vulnerabilities.

Instead, report them privately via [GitHub's private vulnerability reporting](https://github.com/Intentional-Society/is-app/security/advisories/new). Include:

- A description of the vulnerability and its potential impact
- Steps to reproduce or a proof of concept
- Any suggested mitigations if you have them

We aim to acknowledge reports within 48 hours and provide a resolution timeline within 7 days.

**Scope:** `app.intentionalsociety.org` only. The marketing site (`www.intentionalsociety.org`) is out of scope.

---

## Secret Rotation Guide

If a secret is suspected compromised, rotate it immediately using the steps below.

### `CI_RESET_TOKEN`

**Impact if leaked:** An attacker can POST to `/api/_test/reset` on preview/dev deployments and wipe profile fields + invites for the two e2e test accounts. No production data is at risk (the endpoint returns 404 in production).

**To rotate:**
1. Generate a new random string (e.g. `openssl rand -hex 32`)
2. Update the `CI_RESET_TOKEN` secret in GitHub Actions (Settings → Secrets → Actions)
3. Update the `CI_RESET_TOKEN` env var in Vercel for Preview and Development environments
4. Optionally update `CI_RESET_TOKEN` in `.env.local.example` (the value there is arbitrary — any string works locally)

### `E2E_REGULAR_PASSWORD` / `E2E_ADMIN_PASSWORD`

**Impact if leaked:** An attacker can sign in as one of two fake e2e accounts (`e2e-regular@testfake.local` / `e2e-admin@testfake.local`). These accounts contain no real member data. The admin account currently has no working admin surface (it is a stub returning `NotImplemented`).

**To rotate:**
1. Change the password in the Supabase dashboard → Authentication → Users (production project)
2. Update the corresponding secret in GitHub Actions (Settings → Secrets → Actions)
3. Update `.env.local.example` if the local default changed (though local values are arbitrary)

### `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY`

**Impact if leaked:** Valid for `auth/v1` endpoints only — it cannot reach application data because the Supabase Data API is disabled. An attacker could submit OTP requests against real email addresses (the Supabase enumeration oracle described in `docs/doc-supabase.md`), but cannot read or write member data.

**To rotate:** Generate a new key in the Supabase dashboard → Project Settings → API → Reset publishable key. Update Vercel env vars and re-deploy.

### `SENTRY_AUTH_TOKEN`

**Impact if leaked:** Attacker can upload source maps to or delete releases in the Sentry project. No member data is accessible.

**To rotate:** Revoke the token in Sentry → Settings → Auth Tokens. Generate a new one and update the Vercel env var.

---

## Long-Lived Admin Account Risk

The `e2e-admin@testfake.local` account has `profiles.is_admin = true`. Because it is a long-lived password-based account (not magic-link), it cannot expire the way a magic-link session does.

**Current blast radius:** Low. The only admin-gated code path is `getProfileForAdmin` in `src/server/profiles.ts`, which throws `NotImplemented`. No admin surface is reachable.

**When admin features land:** Before shipping any admin-only routes, review whether:
- The e2e admin account password should be rotated to a stronger value
- The `isAdmin` check should require a second factor or short-lived session
- Admin routes should be restricted by IP or VPN in addition to the flag

**If you suspect the e2e admin credentials are compromised:** Rotate `E2E_ADMIN_PASSWORD` per the steps above. The account has no real privileges today, but rotating is cheap and restores confidence.
