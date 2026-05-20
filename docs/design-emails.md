# Auth Email Templates — Design

**Tracking:** [#45](https://github.com/Intentional-Society/is-app/issues/45)

**Context:** Supabase auth emails (magic link, signup confirmation, password
recovery) currently use the stock Supabase templates — generic copy, no IS
voice. Transactional delivery itself is already branded: Resend SMTP with
sender `devteam@mail.intentionalsociety.org` and name "Intentional Society
Web App" (see [`doc-resend.md`](./doc-resend.md)). The only piece left is the
body of the emails.

This document covers how those templates are authored, versioned, and pushed
to the hosted project.

---

## Templates in scope

The IS app uses passwordless sign-in plus a password-reset flow, and does not
call Supabase's admin `inviteUserByEmail` (the IS invite-code system runs on
top of an ordinary magic-link send). That makes two Supabase templates
reachable:

| Supabase template | Triggered by                                    |
| ----------------- | ----------------------------------------------- |
| `magic_link`      | `/signin` and `/signup` (both existing and new emails) |
| `recovery`        | `/forgot-password`                              |

**Verified in Inbucket during implementation:** the `confirmation` template
(commonly assumed to fire for brand-new signups) is *not* reached by current
flows. GoTrue's `/otp` endpoint sends the `magic_link` template for both
existing and new users; `confirmation` only fires from `signUp({ email, password })`,
which the app doesn't call anywhere. So a single magic-link template body
needs to read naturally for both "sign in" and "first-time sign up" cases.

The remaining templates (`invite`, `confirmation`, `email_change`,
`reauthentication`) are unreachable from current UI and stay on Supabase
defaults.

---

## Source of truth

Template bodies live in the repo:

```
supabase/templates/
  magic-link.html
  confirmation.html
  recovery.html
  templates.manifest.mjs    # type → { subject, file }
```

The HTML files are the single source of truth. Subjects sit alongside them
in `templates.manifest.mjs` because Supabase carries the subject as a
separate config field, not as `<title>` on the body.

Files are self-contained — no shared layout / partials. For three templates
the duplication is cheap; introducing a build step would be premature.
If the count grows, the option is to compose at build time into a
gitignored `supabase/templates/_generated/` directory that both the local
config and the prod sync read from.

---

## Local dev wiring

`supabase/config.toml` already supports per-template overrides. Each template
gets a block referencing the file by path relative to `supabase/`:

```toml
[auth.email.template.magic_link]
subject = "Your Intentional Society sign-in link"
content_path = "./templates/magic-link.html"

[auth.email.template.confirmation]
subject = "Confirm your Intentional Society account"
content_path = "./templates/confirmation.html"

[auth.email.template.recovery]
subject = "Reset your Intentional Society password"
content_path = "./templates/recovery.html"
```

`supabase start` picks these up. Config changes are not hot-reloaded — a
`npm run dev:db:stop && npm run dev` cycle is needed after editing
`config.toml` or any referenced template.

Outbound mail on the local stack still lands in Inbucket
(`http://localhost:54324`); Resend is production-only.

The subjects and paths are duplicated between `config.toml` and
`templates.manifest.mjs`. Keeping them in step is a manual discipline; a
lint check could enforce it later if drift becomes a real problem.

---

## Production sync

A `scripts/update-email-templates.mjs` reads the manifest + HTML files and
`PATCH`es the hosted project's auth config via the Supabase Management API:

```
PATCH https://api.supabase.com/v1/projects/{ref}/config/auth
Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}

{
  "mailer_subjects_magic_link": "...",
  "mailer_templates_magic_link_content": "<html>...</html>",
  "mailer_subjects_confirmation": "...",
  "mailer_templates_confirmation_content": "<html>...</html>",
  "mailer_subjects_recovery": "...",
  "mailer_templates_recovery_content": "<html>...</html>"
}
```

Shape and conventions mirror `scripts/update-main-branch-protection.mjs`:

- Idempotent — re-running with no changes is a no-op from the user's
  perspective (the API accepts identical payloads happily).
- `--dry-run` prints the payload without sending.
- Reads `SUPABASE_ACCESS_TOKEN` from the environment; refuses to run if
  unset. The token is an ops-time secret, not a runtime env var — it is
  **not** set in Vercel, only on the operator's machine (like the `gh`
  token used by the branch-protection script).
- Project ref is the constant `oyuzjowguujwhqyhijzx` (already in
  `doc-supabase.md`).

Running it is a manual step after editing a template:

```
node scripts/update-email-templates.mjs --dry-run
node scripts/update-email-templates.mjs
```

CI integration (auto-push on changes to `supabase/templates/**`) is
plausible but deferred — the manual model matches every other ops script
in the repo and keeps the prod-mutating token off CI for now.

### Why not `supabase config push`

`supabase config push` would send the entire `config.toml` auth block to
the hosted project in one shot — including `site_url`, `additional_redirect_urls`,
rate limits, and the unrelated auth.email knobs. Our `config.toml` is
deliberately localhost-tuned (`site_url = http://127.0.0.1:3000`, localhost
allowlist), so a full push would clobber prod URL config.

The Management API `PATCH` is surgical: only the `mailer_*` fields move.

### Drift detection

A `--check` mode (later, not in the first cut) would `GET` the same
endpoint and diff remote subjects/content against the repo. Until then,
the manifest's stated subjects are the contract — if someone edits a
template in the Supabase dashboard, the next `update-email-templates.mjs`
run silently overwrites it. That's the intended behaviour: repo wins.

---

## Template variables

Supabase substitutes Go-template variables before sending. The ones in use:

- `{{ .ConfirmationURL }}` — the full action link (must be present for
  links to work). All three reachable templates need this.
- `{{ .Email }}` — recipient address. Useful for clarity in body copy.
- `{{ .SiteURL }}` — hosted site URL (`https://app.intentionalsociety.org`
  in prod). Useful for footer links.
- `{{ .Data.displayName }}` — `auth.users.user_metadata.displayName`.
  Populated by `/signup` (`signInWithOtp` `options.data`) and by the
  CSV importer; absent on admin-created users. Always wrap with
  `{{ if .Data.displayName }}…{{ end }}` so the missing case renders
  cleanly. Verified against Supabase docs: `{{ .Data }}` is
  user_metadata, not per-request options.data.

Templates are HTML; Supabase wraps them in a minimal MIME envelope. Email
clients vary wildly in CSS support — keep styling inline and conservative
(tables for layout if needed, no flex/grid).

---

## Deliverability and visual consistency

Templates are written for inbox placement, not just rendering: table-based
layout with inline styles, system font stack only, no images, single CTA
per email, plain-text fallback URL beside each button, and subject lines
free of urgency/marketing language. SPF, DKIM, and DMARC alignment are
already handled at the Resend layer (see `doc-resend.md`).

The outer page background is hardcoded `#eff5f2` — the sRGB equivalent
of the app's `--background` token (`oklch(0.965 0.007 165)` in
`src/app/globals.css`). It lives as a hex literal because email clients
don't reliably support `oklch()` (Outlook in particular). If the app
token changes, re-derive: there's a worked conversion in the issue-45
PR description, or use any oklch-to-sRGB tool.

The Resend changelog (2025-08-21) documents automatic plain-text
generation for the Node SDK but is silent on the SMTP relay path. Empirical
check on past sends from our prod stack: they arrive as `multipart/alternative`
with both `text/plain` and `text/html` parts, so Resend's auto-text covers
the SMTP path too. Authoring HTML-only templates is safe.

## Doc cleanup

The introducing PR moves the Supabase dashboard SMTP config out of
`doc-resend.md` into `doc-supabase.md` (new "Authentication → SMTP"
subsection) — `doc-supabase.md` is where Supabase dashboard fields
live. The move also clears doc-resend's stale "Current state" section,
leaving doc-resend focused on the Resend provider itself (sending
domain, DMARC, alternatives). The header line's "Email templates
pending customization" wording is cleared the moment the templates
ship.

---

## Future work

- **Password-changed notification** — `[auth.email.notification.password_changed]`
  (commented in `config.toml`) sends a "your password was just changed"
  email when `updateUser({ password })` is called. A small security win;
  deferred until there's a request.
- **Drift detection** — `update-email-templates.mjs --check` to diff
  remote against repo. Cheap once the push path is in place.
- **CI auto-push** — on changes to `supabase/templates/**`, run the
  script from a workflow. Requires storing `SUPABASE_ACCESS_TOKEN` as a
  GitHub secret; defer until manual hand-edits become a friction point.
- **Shared layout** — composed build step into
  `supabase/templates/_generated/` if the template count grows past
  three.
- **VML bulletproof button for Outlook Windows desktop** — Mailpit's
  HTML Check (caniemail unweighted) puts us at ~90%; the remaining gap
  is mostly Outlook 2007–2019 (no `border-radius`, no `display:inline-block`
  on anchors) and niche regional webmail. The standard fix is
  `<!--[if mso]>` conditional comments wrapping a VML `RoundRect`
  around the button. Deferred unless an Outlook-using member complains
  — market-share-weighted, real-world rendering is already ~95%+.
