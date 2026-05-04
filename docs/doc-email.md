# Email — Configuration Reference

Covers transactional email (auth confirmations, password resets, invite-flow magic links) and how it relates to the existing newsletter stack. **Status: pending — provider not yet provisioned.** Picked up 2026-05-02; resuming next session.

---

## Current state

Supabase auth emails are sent via Supabase's built-in SMTP. Supabase explicitly labels this service for testing only:

- 2 emails/hour rate limit on the default service
- No SLA on delivery or uptime
- Sender domain not aligned to `intentionalsociety.org`, so SPF/DKIM/DMARC do nothing for us
- Risk at launch: a small burst of signups (or password resets after a comms blast) can hit the rate limit and break onboarding

---

## Leading direction: Postmark

Deliverability is the top priority for this decision. Postmark is the leading candidate over Resend on architectural grounds, not just marketing claims:

- **Message Streams** — Postmark forces transactional and broadcast email onto separate IP pools with independent reputation scores. Gmail officially recommends this exact separation. Resend doesn't separate them, so a marketing-side complaint spike could drag down auth deliverability.
- **Strict shared-pool policy** — Postmark refuses promotional senders entirely and actively boots senders that hurt reputation, keeping the shared IP pool clean.
- **Track record** — Postmark since 2009; Resend since 2023. Resend routes through Amazon SES under the hood, so "Resend vs. Postmark" is really "SES with a developer wrapper vs. vertically integrated transactional infrastructure."
- **Measured numbers** — third-party tests put Postmark at ~98.7% inbox placement and ~26ms median response; Resend ~79ms median, no comparable inbox-placement number published.

**Cost:** free dev tier (100 emails/mo, never expires) covers pre-launch. Basic plan **$15/mo** for 10k emails once outgrown — already allocated in `docs/budget.md`.

---

## Alternatives considered

- **Resend** — better DX (React Email, Vercel-ecosystem feel), bigger free tier (3k/mo, 100/day). Lower pick because deliverability is the priority and Resend's underlying infrastructure is SES with no transactional/broadcast separation.
- **Amazon SES** — cheapest by far ($0.10/1k after free tier). Lower pick because of operational overhead (DNS/IAM fiddling, no dashboard worth speaking of) when the difference at our volume is single-digit dollars.

---

## Newsletters and the boundary

Buttondown handles newsletters and program announcements; we tag users via API to send program-related emails. That stays.

The split going forward:

- **Announcement-shaped** (cohort kicks off, monthly digest) → Buttondown. Triggered by *us* deciding to tell a group something.
- **Event-shaped** (you've been added to program X, your application was approved, password reset) → Postmark. Triggered by *one user doing one thing*.

Buttondown is not a candidate for the Supabase auth slot — it's a newsletter platform, not a transactional SMTP backend.

---

## Open items for next session

- [ ] Confirm Postmark as the choice (or revisit if priorities shift)
- [ ] Provision Postmark account, verify `intentionalsociety.org` sender domain (SPF, DKIM, DMARC, Return-Path)
- [ ] Configure Supabase Auth → SMTP with Postmark credentials
- [ ] Bump Supabase Auth rate limit from default 30/hour for custom SMTP up to a sensible launch level
- [ ] Decide on a "From" address (e.g. `noreply@intentionalsociety.org` vs. a human-looking address)
- [ ] Update Supabase email templates so the body matches our voice and the footer/sender is on-brand
- [ ] Add a `docs/devjournal.md` entry once provisioned
