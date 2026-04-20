# Plan: Require recent authentication to change a password

## Goal

Close the session-hijack → persistent-account-takeover path on the
`/welcome` password-set flow by requiring a fresh re-authentication
nonce before `supabase.auth.updateUser({ password })` is accepted.

## The gap today

Phase 2 landed a welcome form that lets any authenticated user set a
password with a single client-side call:

```ts
await supabase.auth.updateUser({ password });
```

No current-password prompt, no recency check. Any valid session —
magic-link click, stolen cookie, XSS payload, forgotten laptop — can
pivot to persistent access by setting a new password. The legitimate
user rotating their session doesn't evict the attacker, because the
password is now the attacker's.

Supabase's default configuration allows this. Our `supabase/config.toml`
currently has:

```toml
secure_password_change = false
```

## The fix

Two coordinated changes:

1. **Flip the Supabase setting on.** Both locally and in the hosted
   project's Auth settings. With it on, GoTrue rejects `updateUser`
   password changes unless the session has a recent reauth nonce.
2. **Add a `reauthenticate()` step to the welcome form.** When a
   password is being set, call `supabase.auth.reauthenticate()` first —
   this sends a one-time code to the user's email. The form collects
   the code and passes it to `updateUser({ password, nonce })`.

## Config changes

`supabase/config.toml`:

```diff
-secure_password_change = false
+secure_password_change = true
```

Hosted Supabase project: Auth → Providers → Email → toggle "Secure
password change" on. Document the setting location in `docs/doc-supabase.md`.

## Code changes

`src/app/welcome/welcome-form.tsx`:

- Add a "reauth code" state and input, shown only after the user
  submits and a reauth email is sent.
- Flow on submit when password is non-empty:
  1. Save profile via `PUT /api/me` (unchanged).
  2. Call `supabase.auth.reauthenticate()`. Show the reauth-code input
     and a message: "Check <email> for a 6-digit code to confirm the
     password change."
  3. User enters the code. Call
     `supabase.auth.updateUser({ password, nonce: code })`.
  4. On success → redirect to `/`.
- If password is empty: skip the reauth dance entirely; flow is
  unchanged from today.
- Error messages must distinguish "couldn't send code" from "code
  invalid or expired" so the user can self-correct.

## UX trade-off

Setting a password now takes a second form submission and an email
round-trip. That's friction, but it's the same friction Supabase
recommends for any password-write surface — and the welcome-form case
is first-sign-in only, so most members hit it once.

Members who skip the password field on `/welcome` are unaffected.
Future password-change surfaces (settings page) will inherit the same
flow for free, since the enforcement is server-side.

## Tests

- **Functional:** nothing to add — the enforcement lives in GoTrue,
  not our code. Our existing `PUT /api/me` tests don't touch passwords.
- **E2E:** deferred. Verifying the reauth dance end-to-end would need
  inbox access (we don't mint real sessions in e2e yet — Phase 3 owns
  the session helper). For now, manual smoke on a staging project is
  enough.

## Rollout

1. Flip `config.toml` + hosted project setting.
2. Ship the welcome-form reauth flow in the same PR so no one hits a
   broken state (config-on + no reauth = silent failure when setting
   a password).
3. Devjournal entry documenting the gap and the fix.

## Out of scope

- Current-password confirmation on password change. `reauthenticate()`
  via email is Supabase's recommended path; adding a "type your current
  password" field on top is belt-and-braces and not free (requires a
  `signInWithPassword` round-trip to verify).
- Password strength policy beyond Supabase defaults. Tracked separately
  if/when it comes up.
- Rate-limiting the reauth-code endpoint. GoTrue rate-limits this
  already.
