# Email — Configuration Reference

Covers transactional email (auth confirmations, password resets, invite-flow magic links) and how it relates to the existing newsletter stack. **Status: live since 2026-05-11 — Resend via SMTP into Supabase Auth. Email templates pending customization.**

---

## Provider: Resend

Transactional email runs through Resend as a standalone account (not the Vercel Marketplace integration — separation of vendors over auto-provisioning convenience).

- **Sending domain:** `mail.intentionalsociety.org` — separate from the apex used by Buttondown. DKIM-signed and SPF-authenticated at this subdomain.
- **Visible From:** `devteam@mail.intentionalsociety.org`. Matches the sending domain, so DKIM signs with `d=mail.intentionalsociety.org` and DMARC alignment is strict (not just relaxed).
- **Replies:** routed via Zoho subdomain stripping. `mail.intentionalsociety.org` has Zoho MX records, and subdomain stripping is enabled on the apex Zoho domain — so any `<anything>@mail.intentionalsociety.org` is delivered to `<anything>@intentionalsociety.org`. The existing `devteam@` alias at the apex then forwards to the operator's inbox. End result: replies to a magic-link email land cleanly without needing a mailbox on the subdomain.

### Why Resend over Postmark

The earlier draft of this doc had Postmark as the leading candidate on architectural grounds (Message Streams separating transactional and broadcast IP pools). That argument is real for high-volume senders but doesn't outweigh:

- **Cost.** Resend's free tier is 3,000/month and 100/day, vs Postmark's 100/month total. Pre-launch and at our member scale we sit comfortably inside Resend's free tier for months.
- **DX feedback.** Operators running production apps on Resend report no deliverability issues and a smoother developer surface (React Email templates, modern SDK).
- **Ecosystem fit.** Vercel-adjacent, common in our stack's neighbourhood.

Resend's underlying infrastructure is SES, which is sometimes raised as a deliverability concern relative to Postmark's vertically-integrated transactional pool. At our launch volume (probably under 100 transactional/month) we are well below the threshold where IP-pool architecture is the dominant deliverability signal — content quality, list hygiene, and complaint rate carry more weight. If we ever outgrow this with observable deliverability issues, Postmark remains a portable second choice — relaxed DMARC alignment doesn't care which provider signs the mail, as long as the records are updated.

### Why a subdomain

Two reasons converge:

1. **Resend requires the From-header domain to be a verified domain in the account.** We verified `mail.intentionalsociety.org`. Sending from `@intentionalsociety.org` would have required verifying the apex too — feasible, but then either Resend signs apex DKIM (sharing the apex DKIM-reputation surface with Buttondown) or we leave the apex verification idle. Neither pays for itself.
2. **Reputation isolation from Buttondown.** The apex is Buttondown's sender for the newsletter, with 5+ years of strong reputation (250+ editions, ~60% open rates). Sending Resend's transactional traffic on a subdomain means each provider has its own DKIM selector and signing domain; a complaint spike on one doesn't drag the other down.

At our volume (<100 transactional/month) the reputation-isolation argument is modest in absolute terms. Operational hygiene is the bigger win, and it's the pattern Resend's own docs recommend.

The cost of going subdomain rather than apex is a slightly less polished visible From (`@mail.intentionalsociety.org` instead of `@intentionalsociety.org`). Zoho's subdomain stripping makes replies still work cleanly through the existing apex alias, so the only real-world "cost" is the subdomain visible in the From address itself.

---

## Newsletters and the boundary

Buttondown handles newsletters and program announcements, sending from `@intentionalsociety.org` (apex). We tag users via API to receive program-related emails. That stays.

The split going forward:

- **Announcement-shaped** (cohort kicks off, monthly digest) → Buttondown, from apex. Triggered by *us* deciding to tell a group something.
- **Event-shaped** (magic link, password reset, invite accepted) → Resend, from `mail.intentionalsociety.org`. Triggered by *one user doing one thing*.

Buttondown is not a candidate for the Supabase auth slot — it's a newsletter platform, not a transactional SMTP backend.

---

## DMARC

`_dmarc.intentionalsociety.org` is already configured at the apex:

```
v=DMARC1; p=none; pct=100; rua=mailto:re+u9zmncpm6mf@dmarc.postmarkapp.com; sp=none; aspf=r
```

`p=none` is report-only. Postmark's free DMARC monitoring service receives weekly XML reports; once Resend is verified, its sends will start showing up there alongside Buttondown's. Apex DMARC covers all subdomains by default, so `mail.intentionalsociety.org` is included automatically.

Ratcheting to `p=quarantine` is a future move after a few weeks of clean reports across both providers.

---

## Wiring into Supabase Auth

The SMTP credentials, sender values, and rate-limit setting are entered into the Supabase dashboard — see `docs/doc-supabase.md` → "Authentication → SMTP". Local dev does not route through Resend; the local stack uses Inbucket.

---

## Alternatives considered

- **Postmark** — discussed above. Stronger on deliverability architecture and longer track record; loses on cost (100/mo free vs Resend's 3k) and DX fit.
- **Amazon SES** — cheapest by far ($0.10/1k after free tier). Lower pick because of operational overhead (DNS/IAM fiddling, no dashboard worth speaking of) when the difference at our volume is single-digit dollars per year.
