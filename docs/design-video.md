# Design — Video recordings

Status: **draft**, started 2026-10-13. Nothing implemented. A spike (below) settles the open questions before build.

## Goal

Members upload program recordings — mostly Zoom, often over an hour — and other members watch them in the app. Playback is members-only, optionally narrowed to one program's participants. Uploaders own what they upload; there is no moderation. Uploads have no practical size limit, and the library grows to hundreds of GB, then past 1 TB.

## Choice: Bunny Stream

Bunny Stream transcodes uploads to adaptive bitrate, serves them from its CDN, and signs playback with expiring tokens. It bills storage per GB; Cloudflare Stream and Mux bill per minute stored. A recording library is storage-heavy and view-light, so per-GB storage is the cheapest model.

Mux is one contender. It discounts storage automatically for assets not played in 30 days (40% off) or 90 days (60% off), so a library of mostly old recordings costs 2–5× Bunny. In exchange it is the only video integration in the Vercel Marketplace (provisioning, env vars, and billing through Vercel), ships `next-video` for Next.js, and includes playback analytics. The discount requires MP4 renditions off, which this design already specifies.

Livid is the other. Premium ($24 / month billed annually) includes 4 TB of storage, 3 TB / month of bandwidth, and API access, so its price stays flat until the library passes 4 TB. Its API supports direct browser uploads to a Google Cloud Storage link our server creates. It has no webhooks, so the Encode step would poll for `status = ready`, and no signed playback tokens: the closest to members-only is an unlisted video with embeds limited to our domain (`embedAllowedDomains`) and its Livid watch page turned off. Livid launched in January 2026; Bunny's CDN dates from 2015.

Monthly cost at 1 TB — about 1,250 hours (75,000 min) of Zoom video at 800 MB/hour — with 500 member-hours (30,000 min) watched per month:

| Provider             | Storage                                                    | Delivery                           | Total                     |
| -------------------- | ---------------------------------------------------------- | ---------------------------------- | ------------------------- |
| Cloudflare Stream    | $375 ($5 / 1,000 min)                                      | $30                                | ~$405                     |
| Mux                  | $72–223 ($0.00096–0.003 / min by resolution and last play) | free (100,000 min / month)         | ~$50–205 after $20 credit |
| Livid                | Premium plan (4 TB cap)                                    | included (3 TB / month)            | $24                       |
| **Bunny Stream**     | $10–20 ($0.01 / GB, 1–2× for renditions)                   | $2–24 ($0.005–0.06 / GB by region) | **~$15–45**               |
| R2 + own transcoding | $15                                                        | $0                                 | ~$15 + a pipeline to run  |

Mux's low end assumes 720p recordings, most of them unplayed for 90+ days; its high end assumes 1080p, all played within the month. Zoom's recording resolution decides which Mux rate applies.

List prices checked 2026-10-13; Mux and Livid checked 2026-11-19. Sources: [Cloudflare Stream](https://developers.cloudflare.com/stream/pricing/), [Mux pricing](https://www.mux.com/docs/pricing/video), [Mux cold storage](https://www.mux.com/docs/changelog/automatic-cold-storage-ga), [Mux on Vercel](https://vercel.com/marketplace/mux), [Livid pricing](https://livid.com/pricing), [Livid API](https://livid.com/developers/reference), [Livid about](https://livid.com/about), [Bunny's story](https://bunny.net/our-story/), [Bunny Stream](https://bunny.net/pricing/stream/), [Bunny CDN](https://bunny.net/pricing/), [R2](https://developers.cloudflare.com/r2/pricing/).

### Also considered

- **Supabase Storage.** An hour of video is 800 MB against a 5 GB free egress quota that avatars alone have exceeded (#382), and it does no transcoding.
- **R2 with our own transcoding.** Matches Bunny's price but makes us own transcoding and playback.
- **Vercel Blob.** File storage with no transcoding or player; it has Supabase Storage's problems.
- **Gcore Video Streaming.** Per-minute like Mux, with no discount for unplayed assets: €0.002 / min stored and €0.00064 / min delivered, about €170 / month at 1 TB. Token-signed URLs are documented only for enterprise CDN setups.
- **api.video.** Per-minute at about Mux's undiscounted rates ($0.003 / min stored, $0.0017 / min delivered), with no cold-storage discount found.
- **Gumlet.** Fixed plans; the largest self-serve plan ($199 / month) includes 15,000 storage minutes against our 75,000.
- **Zoom cloud recording.** Leaving recordings in Zoom needs no build, but its storage pricing is far above the options here, and access would depend on Zoom passcodes instead of the app's membership checks.
- **YouTube unlisted.** An unlisted link plays for anyone who has it, which fails members-only playback.
- **Vimeo.** Its plan usage policy puts accounts "used by or for a company, team, nonprofit, government entity, or other organization" on a business plan, and business accounts can't use the individual plans (Core, Professional). That leaves Studio at $400 / month, billed annually only. Its domain-level embed privacy checks the embedding page's Referer, which is weaker than expiring tokens.

Prices for this section checked 2026-11-19. Sources: [Gcore](https://gcore.com/pricing/edge-network), [api.video](https://api.video/pricing/), [Gumlet](https://www.gumlet.com/blog/gumlet-pricing-update-2026/), [Vimeo 2026 plans](https://help.vimeo.com/hc/en-us/articles/52596250640785-About-changes-to-Vimeo-plans-in-2026), [Vimeo plan usage policy](https://vimeo.com/legal/policies/plan-usage).

## Flow

1. **Create.** The member picks a file. Hono creates the video in the Bunny library, inserts a `videos` row (`status = uploading`), and returns the Bunny video ID plus a short-lived TUS upload signature.
2. **Upload.** The browser uploads straight to Bunny over TUS, which resumes after dropped connections. The file never touches Vercel, whose function bodies cap at 4.5 MB.
3. **Encode.** Bunny's webhook hits a Hono route on encode completion, which sets `status = ready` and records duration.
4. **Play.** The watch page asks Hono for playback. Hono checks visibility against the viewer, then signs a short-lived embed token for Bunny's iframe player. CDN token auth guards the underlying HLS segments; MP4 fallback stays off.
5. **Delete.** The uploader (or an admin) deletes; Hono removes the Bunny video, then the row.

## Schema

New `videos` table: `id`, `bunnyVideoId`, `uploaderId`, `programId` (null = all members), `title`, `description`, `durationSeconds`, `status` (`uploading | processing | ready | failed`), `createdAt`. A new table needs only the expand step.

## Privacy

Signed, expiring tokens make shared links useless outside the app. A member can still screen-record what they can watch; access control governs who watches, and that is its limit. Recording consent is the uploader's responsibility, consistent with their ownership of the upload.

## Platform changes

- CSP: add Bunny's player origin to `frame-src` in `next.config.ts` (today it inherits `default-src 'self'`).
- Secrets: Bunny library ID, API key, token-auth key, webhook secret.
- Billing alert on the Bunny account: cost tracks library size linearly.

## Spike

One real Zoom recording through a Bunny trial answers:

- Bunny's maximum upload size.
- Rendition overhead — total stored GB per source GB.
- TUS upload signed from our server, end to end from the browser.
- Embed token plus CDN token together, and that an expired token fails.
- Webhook payload, signature verification, and retry behavior.
- Player domain for CSP.

## Later

- Archive originals to R2 (~$15 / TB / month) as an exit path from Bunny.
- Captions: Bunny's auto-transcription, if accurate enough.
- Link recordings to the event they came from, once events exist ([design-events.md](design-events.md)).
