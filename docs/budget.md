# Budget

Recurring costs for the app stack. Last reviewed **2026-05-02**. Provider limits can drift — re-verify before relying on these for capacity planning.

Bare minimum $20/mo (Vercel only), but we could be up to $70 shortly.

## App stack

| Service | Monthly cost | Budget | Plan | What that gets us | Next step-up if outgrown |
|---|---|---|---|---|---|
| **Vercel** | **$20/seat** + usage | $30 | Pro | $20 of included usage credit, then pay-as-you-go: 1 TB fast data transfer, 10M edge requests, $0.014/min standard build minutes, $0.60/1M function invocations | No fixed step-up — overages stack on the same plan. Already incurred overages in month one, but moving to Next16 cut build times by 40% and we're skipping docs-only deploys now so, recheck next month. |
| **Supabase** | $0 | $25 | Free | 500 MB Postgres, 50k MAU, 5 GB egress, 1 GB file storage, 7-day log retention, project pauses after 1 week idle, max 2 active projects | Pro **from $25/mo** — no auto-pause, daily backups, 8 GB DB included, 250 GB egress, point-in-time recovery as add-on. Likely needed at or before launch. |
| **Sentry** | $0 | — | Developer | 5k errors, 50 session replays, 5M performance spans per month; 1 seat | Team **$26/mo** (annual billing) — unlimited seats, more events, third-party integrations |
| **Axiom** | $0 | — | Personal | 500 GB/mo ingest, 30-day retention, 10 GB-hrs query compute, 25 GB storage, 2 datasets, 1 user | Axiom Cloud **from $25/mo** — 1 TB ingest, 100 GB-hrs query, configurable retention, usage-based beyond included |
| **GitHub** | $0 | — | Free org | Unlimited public-repo Actions; 2,000 Actions minutes/mo on private repos | Team **$4/user/mo** — 3,000 Actions minutes/mo on private repos plus more collaboration features |
| **Transactional email** | $0 today | $20 | Resend Free | 3,000 emails/mo + 100/day cap, single sending domain, 1-day log retention | Resend Pro **$20/mo** — 50k emails/mo, no daily cap, multiple domains, 3-day log retention. Postmark and SES remain alternatives if deliverability ever forces a switch — see `docs/doc-email.md`. |

## Budgeted elsewhere

- **Domain** — `intentionalsociety.org` annual registrar renewal (~$15/yr).
- **Newsletters** — Buttondown subscription, already paid outside the app stack. Listed here only so total cost of comms is visible.
