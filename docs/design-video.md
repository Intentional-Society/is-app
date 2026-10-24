# Design — Video recordings

Status: **draft**, started 2026-10-13. Nothing implemented. A spike (below) settles the open questions before build.

## Goal

Members upload program recordings — mostly Zoom, often over an hour — and other members watch them in the app. Playback is members-only, optionally narrowed to one program's participants. Uploaders own what they upload; there is no moderation. Uploads have no practical size limit, and the library grows to hundreds of GB, then past 1 TB.

## Choice: Bunny Stream

Bunny Stream transcodes uploads to adaptive bitrate, serves them from its CDN, and signs playback with expiring tokens. It bills storage per GB; Cloudflare Stream and Mux bill per minute stored. A recording library is storage-heavy and view-light, so per-GB storage wins by an order of magnitude.

Monthly cost at 1 TB — about 1,250 hours of Zoom video at 800 MB/hour — with 500 member-hours watched per month:

| Provider | Storage | Delivery | Total |
|---|---|---|---|
| Cloudflare Stream | $375 ($5 / 1,000 min) | $30 | ~$405 |
| Mux | $225 ($0.003 / min) | free tier | ~$205 |
| **Bunny Stream** | $10–20 ($0.01 / GB, 1–2× for renditions) | $2–24 ($0.005–0.06 / GB by region) | **~$15–45** |
| R2 + own transcoding | $15 | $0 | ~$15 + a pipeline to run |

Supabase Storage is ruled out: an hour of video is 800 MB against a 5 GB free egress quota that avatars alone have exceeded (#382). R2 matches Bunny's price but makes us own transcoding and playback.

List prices checked 2026-10-13. Sources: [Cloudflare Stream](https://developers.cloudflare.com/stream/pricing/), [Mux](https://www.mux.com/pricing), [Bunny Stream](https://bunny.net/pricing/stream/), [Bunny CDN](https://bunny.net/pricing/), [R2](https://developers.cloudflare.com/r2/pricing/).

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
