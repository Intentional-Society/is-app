# Plan: Cross-browser magic links and password-reset links

**Tracking:** [#269](https://github.com/Intentional-Society/is-app/issues/269)

## Goal

A user clicks a sign-in or password-reset link from their email client
and lands in a browser that *isn't* the one they used to request it.
Today that fails with `error=exchange_failed`; the email template even
warns "Open the link in the browser where you requested it." After this
change, the link works regardless of which browser opens it.

## Root cause

`@supabase/ssr` hard-codes `flowType: "pkce"` on both browser and server
clients
(`node_modules/@supabase/ssr/dist/module/createBrowserClient.js:37`,
`createServerClient.js:30`). With PKCE:

- `signInWithOtp` generates a code verifier and writes it to a cookie on
  the requesting browser
  (`node_modules/@supabase/ssr/dist/module/cookies.js:288–308`).
- The email link Supabase generates is `…/auth/callback?code=<short>`.
- The callback calls `supabase.auth.exchangeCodeForSession(code)`, which
  needs the verifier cookie to complete the exchange.
- A different browser has no verifier cookie → exchange fails
  (`src/app/auth/callback/route.ts:31–34`).

The original issue's "Consider PKCE" hypothesis is inverted: PKCE is the
cause. The Supabase-documented fix for this scenario is the **token-hash
+ `verifyOtp`** flow (server-only, browser-agnostic). `flowType` stays
on PKCE — that still governs session cookies and refresh rotation, which
we want. We swap out only the *email-verification* step.

## The fix

### Email templates

Template URLs follow the Supabase docs' canonical token-hash pattern:

- `supabase/templates/magic-link.html` (button `href` and plain-text URL)
  → `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email&next={{ .RedirectTo }}`
- `supabase/templates/recovery.html` → same shape with `type=recovery`
- Both: drop the "Open the link in the browser where you requested it"
  copy. Keep just "it expires in 1 hour." Phrase in the positive frame.

`type=email` covers both new and returning users for magic-link sign-in;
`magiclink` would reject brand-new signups and `signup` would reject
existing members. `type=recovery` is the recovery-flow value.

`{{ .TokenHash }}` is always populated by Supabase regardless of
`flowType`; `{{ .RedirectTo }}` substitutes to whatever `emailRedirectTo`
the client passed (or the Site URL if absent).

### New `/auth/confirm` route, old `/auth/callback` deleted

Add `src/app/auth/confirm/route.ts`:

1. Read `token_hash`, `type`, `next` from query.
2. Missing `token_hash` → redirect `/signin?error=missing_token`.
3. `supabase.auth.verifyOtp({ token_hash, type })`. Failure →
   `/signin?error=verify_failed`.
4. `type === "recovery"` → redirect `/auth/reset-password`.
5. Otherwise parse `next` as a URL, pull `invite` from its query, and
   run the existing post-verification logic — profile upsert (no
   invite) or transactional invite redemption (with invite). Final
   redirect goes to `next.pathname` (dropping `?invite=…` so it
   doesn't linger in the address bar).

Delete `src/app/auth/callback/route.ts` in the same PR. Lift the
shared post-verification block (profile upsert, invite redemption,
auto-subscribe) into a helper module — both the recovery and magic
branches share it.

### Forms repointed

`{{ .RedirectTo }}` flows into `next`, and the confirmer treats `next`
as "where to land the user post-verification." Today the forms point
`emailRedirectTo` at `/auth/callback?…`, which this PR deletes. Update
to real destinations:

- `src/app/signin/signin-form.tsx`: `${origin}/auth/callback` →
  `${origin}/` (both call sites).
- `src/app/signup/signup-form.tsx`: `${origin}/auth/callback?invite=${code}`
  → `${origin}/?invite=${code}`. Also drop the "Open it in this same
  browser" phrase from the post-send copy.
- `src/app/forgot-password/forgot-password-form.tsx`:
  `${origin}/auth/callback?type=recovery` → `${origin}/auth/reset-password`.
  The template's `type=recovery` already drives both `verifyOtp`'s
  recovery branch and the confirmer's redirect, so the form-side
  `?type=recovery` is redundant.

### Tests

Move `tests/functional/server/auth-callback.test.ts` →
`auth-confirm.test.ts`. Swap the `exchangeCodeForSession` mock for
`verifyOtp`; rewrite request URLs to
`/auth/confirm?token_hash=…&type=email&next=/?invite=…`. Existing
assertions (profile upsert, invite redemption, recovery redirect) stay.

`tests/e2e/password-reset.spec.ts`: keep working as-is unless it
asserts on URL substrings — update `?code=` to `?token_hash=` if so.

### Local dev wiring

No `supabase/config.toml` change. Template contents are picked up on
the next `npm run dev:db:stop && npm run dev` (templates aren't
hot-reloaded).

## Cut-over (hard)

1. Merge PR → Vercel auto-deploys. `/auth/confirm` is live; old
   `/auth/callback` is gone.
2. Immediately run `npm run download_email_templates` (snapshot for
   diff/rollback) then `npm run update_email_templates -- --dry-run`
   then `npm run update_email_templates`. Prod templates now issue
   `/auth/confirm?token_hash=…` URLs.
3. Between (1) and (2) — a few minutes — Supabase is still sending
   emails built from the *old* prod template that point at
   `/auth/callback?code=…`, which is now 404. Users in that window
   can click "Resend" on the SentView to get a working link. Not a
   regression vs the prior failure mode (wrong-browser click), just
   different.

## Verification

- **Functional**: `npm run test:functional` — `auth-confirm` suite plus
  the rest.
- **Local cross-browser smoke**: `npm run dev:db:stop && npm run dev`,
  send a magic link from Chrome, copy the URL out of Inbucket
  (`http://localhost:54324`), paste it into Firefox or a private
  window. Expect sign-in to succeed and the session cookie to land in
  the second browser. Repeat for `/forgot-password`.
- **E2E**: `npm run test:e2e` — `password-reset.spec.ts` exercises the
  full recovery flow.

## Risk

- `verifyOtp` failures look identical to `exchangeCodeForSession`
  failures from the user's perspective (same `/signin?error=…`
  redirect). No regression in error handling.
- Schema unchanged. No migration. No expand-contract step needed.
- Email-template push is the only prod write — already an established,
  reversible operation with a committed snapshot for rollback (per
  `docs/design-emails.md`).

## Why not the alternatives

- **Pre-send warning + better error page** (the issue's options 1 and
  2): treats the symptom, leaves the cross-browser case fundamentally
  broken. We can ship those *in addition*, but they aren't a
  substitute for the protocol fix.
- **Switch the client to `flowType: 'implicit'`**: implicit flow puts
  the token in the URL hash fragment (`#access_token=…`), which never
  reaches the server. Incompatible with our SSR-cookie session model.
- **Dual-path callback** accepting both `?code=` and `?token_hash=`:
  considered for a softer cut-over (in-flight legacy emails keep
  working for an hour). Rejected as needless complication for a
  failure mode the resend button already handles.
