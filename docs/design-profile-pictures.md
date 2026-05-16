# Design — Profile pictures

Status: design captured 2026-05-16. Not yet implemented. Closes #131
(and #136, the avatar-URL tracking-pixel issue, folded in).

## Goal

Give members real profile pictures: upload a photo from "Edit
profile", crop/zoom it to a circle, store it on infrastructure we
control, and render it everywhere an avatar appears. Retire the
free-text `avatarUrl` field, which today lets any HTTPS host be
fetched by every visitor.

## Where we are today

- `profiles.avatarUrl` is a `text` column holding a user-typed URL.
- The Edit-profile form has a plain "Avatar URL" `<input type="url">`.
- `Avatar` (`src/components/avatar.tsx`) renders `<img src={url}>`
  for any URL, or initials when null. It carries a
  `biome-ignore noImgElement` because the host is unknown.
- Avatars render in: members grid, `/myweb` graph + suggestion cards,
  member typeahead, admin hints, the profile page.

Two problems with the free-text field, from #136:

1. **Tracking-pixel risk** — every visitor's browser fetches whatever
   third-party host a member typed, leaking IP + load time to it.
2. **No optimisation** — an arbitrary host can't go through
   `next/image`, so we serve unbounded original-size images.

## Functionality in scope

- Upload a photo from the Edit-profile screen.
- Crop + zoom + reposition to a circle before saving.
- Resize/compress to a sane fixed size before it leaves the browser.
- Store the file on Supabase Storage; record its location on the
  profile.
- Render via `next/image` from a host we control, everywhere.
- Remove a photo (fall back to initials).
- Replace a photo (old object cleaned up, no orphan).

## Off-the-shelf survey

### Storage backend

| Option | Verdict |
|---|---|
| **Supabase Storage** | **Chosen.** Already in our stack — `[storage]` is enabled in `config.toml`, runs in the local Docker stack, S3-backed with a CDN on the hosted side. No new vendor, no new bill. |
| S3 + CloudFront | Rejected — a second vendor, IAM, and a CDN to wire up for no gain over what Supabase already gives us. |
| Bytes in a Postgres column | Rejected — bloats the DB and its backups, no CDN, defeats `next/image`. An anti-pattern for binary blobs. |

### Cropping UI library

| Library | Notes |
|---|---|
| **`react-easy-crop`** | **Chosen.** ~1.9M weekly downloads, actively maintained. Built-in pinch-zoom and drag, supports a circular crop overlay, and hands back crop geometry we feed to a `<canvas>`. Best mobile UX of the field, small. |
| `react-image-crop` | Lighter and dependency-free, but no zoom — a worse fit for "position your face in the circle". |
| `react-cropper` (Cropper.js) | Heaviest; more than we need. |
| Pintura | Commercial licence. Overkill. |

`react-easy-crop` gives us a crop *rectangle*; the actual pixel
extraction is our own ~30-line `<canvas>` helper. The library does not
upload, resize, or encode — that is deliberate and fine.

### Image resizing

Supabase offers server-side **image transformations** (`?width=&height=`
on the object URL), but only on the **Pro plan**. We will not depend on
it. Instead we **resize in the browser before upload**: the crop step
already produces a `<canvas>`, so we export it at a fixed size. This
works on any plan, uploads less data, and means we store exactly one
predictable file per member. `next/image` handles display-size
downscaling on top.

## Key decisions

### 1. Private bucket, signed URLs (24h TTL)

The `avatars` bucket is **private**. Objects are reachable only via a
**signed URL** — a time-limited, HMAC-signed link minted server-side.
Object paths stay `<userId>/<random-uuid>.webp`.

Rationale — this is a deliberately private membership network, so the
privacy bar sits above a consumer product's. A signed URL is fetchable
without a login *while valid* (the same model Facebook, Instagram, and
Discord settled on for image CDNs — none auth-check every image GET),
but it **expires**: a URL that leaks via a `Referer` header, browser
history, or a pasted link stops working. A public bucket can't offer
that — a leaked public URL is live until the object is deleted.

TTL: **24 hours**. Long enough that re-signing is rare; short enough
that a leaked link dies within a day.

Performance — the member directory renders every member's avatar at
once, so signing must not become N round-trips:

- The Storage signing call is an HTTP request to Supabase, not local
  crypto. Use the **batch** API — `createSignedUrls(paths[], ttl)` —
  which signs the whole directory in **one** round-trip. Never loop
  the single-path `createSignedUrl`.
- **Cache** the signed URLs, keyed by object path, for most of the
  TTL (a module-level `Map` on the Fluid Compute instance, or Next's
  `use cache`). Signing then fires roughly once per TTL per warm
  instance — not once per page view. The directory's hot path does
  zero Storage round-trips.
- The long TTL also keeps `next/image`'s optimizer cache stable: that
  cache is keyed by source URL, so an hourly-churning URL would force
  constant re-optimization. A 24h URL does not.

A per-upload random filename means a replaced avatar gets a new path,
hence a new cache key, so a replace shows immediately rather than
waiting out the TTL.

A public bucket — simpler, no signing — was the alternative; rejected
because it cannot revoke a leaked URL.

### 2. Upload goes through Hono, not browser-direct

The browser sends the processed image to a new Hono endpoint; the
**server** writes it to Storage using a Supabase client with the
**secret key**, then updates the profile row.

Rationale — this matches the app's existing architecture:

- "Hono handles all API logic" (CLAUDE.md). DB access already works
  this way: the server connects as a privileged role and RLS is only a
  backstop. Storage should mirror that.
- Browser-direct upload would require our **first** Storage RLS
  policies and the first browser→Supabase *data* path (today the
  browser only talks to Supabase for auth). Routing through Hono keeps
  that surface closed.
- The server can validate type, size, and decoded dimensions before
  anything is persisted.

The processed upload is small (~100–200 KB WebP), so passing it through
a Vercel function is cheap — and it stays under Vercel's ~4.5 MB
request-body limit only because decision 3 shrinks it first.
Hono-through and the client-side resize are load-bearing for each
other; neither should be removed without the other.

### 3. Resize in the browser, re-encode authoritatively on the server

Two stages, each doing a distinct job:

- **Browser** — after crop-confirm, draw the crop to a `<canvas>` and
  export **WebP** (`canvas.toBlob`, quality ~0.82) at the master size.
  The crop step already produced this canvas, so the resize is nearly
  free. This keeps the upload to ~100–200 KB, which is what makes the
  Hono-through upload (decision 2) fit Vercel's request-body limit.
- **Server** — Hono re-encodes the received image with `sharp` to the
  canonical **1024×1024** WebP, and that is the object stored. The
  client-side resize is a bandwidth optimisation, **not** a trust
  boundary — a crafted client can ignore it. Re-encoding
  unconditionally (rather than detecting whether the input already
  conforms) is simpler to reason about and cheap on a ~150 KB image;
  the stored object is then provably a well-formed 1024² WebP whatever
  arrived.

`sharp` is already in the tree as `next/image`'s dependency, so the
server stage adds no new package.

**Master size 1024².** Display sizes now run up to ~500px CSS (the
profile page), and 1024² leaves 2× headroom for retina at that size.
A WebP at that size lands near 100–200 KB per avatar — small enough to
ignore. Single master only — `next/image` derives the smaller variants
for the members grid and graph nodes. If the many-tiny-avatars `/myweb`
graph later proves heavy, exporting a second small size at upload time
is a minor follow-up.

Re-encoding (either stage) **strips all EXIF metadata**, including GPS
coordinates the camera embedded — a free privacy win.

### 4. Schema: rename the existing column, no new column

`profiles.avatar_url` is unused — zero rows hold a value — so there is
nothing to preserve. It is repurposed in place to hold a **Storage
object path** (e.g. `5f3c…/9a1b…webp`), never a URL. No new column, no
data migration, no expand-contract: the column is empty and this PR
owns every reader and writer of it, so the meaning can simply change.

- **TS side, this PR** — the Drizzle property becomes `avatarPath`,
  still mapped to the SQL column `avatar_url` for now:
  `avatarPath: text("avatar_url")`. Code-only; generates no migration.
- **SQL side, batched later** — the cosmetic `RENAME COLUMN avatar_url
  TO avatar_path` joins the pending-rename batch already waiting on
  `creator_value`, `rater_id`, and `ratee_id` (see the comments in
  `schema.ts`).

The API contract is unchanged: `getProfileForSelf` /
`getProfileForMember` / `listMembers` keep returning a field named
`avatarUrl` — now a server-minted signed URL (decision 1), not user
free-text. `avatarPath` is **never** client-settable via `PUT /me`;
only the upload endpoint writes it, and `avatarUrl` is dropped from
`EDITABLE_PROFILE_FIELDS` so the old free-text field is gone.

Because the column starts empty, #136's tracking-pixel hole closes
completely with this PR — no legacy third-party URLs are left to
render.

## Architecture / data flow

Upload:

```
Edit profile  ──select file──▶  crop modal (react-easy-crop)
      │                               │ crop-confirm
      │                               ▼
      │                       canvas 1024² → WebP blob
      │                               │
      └──────── POST /api/me/avatar (multipart) ───────▶ Hono
                                                          │ validate + re-encode (sharp)
                                                          │ upload (secret key)
                                                          ▼
                                                  Supabase Storage
                                                  avatars/<uid>/<uuid>.webp
                                                          │
                                              UPDATE profiles.avatar_path
                                              + remove previous object
```

Display: the API field `avatarUrl` is a **signed URL** minted
server-side through the path-keyed cache (decision 1) — one batched
`createSignedUrls` call covers a whole directory page — and rendered
through `next/image`. A per-upload random filename gives a replaced
avatar a new path, so a replace shows immediately.

## Implementation steps

### Server

1. **Schema** — rename the Drizzle property `avatarUrl` → `avatarPath`
   on the existing `text("avatar_url")` column in `schema.ts`, with a
   comment that the SQL rename is batched (decision 4). Code-only — no
   `drizzle-kit generate`.
2. **Admin Supabase client** — `src/lib/supabase/admin.ts`, a client
   built with the URL + secret key, server-only. Used for Storage
   writes.
3. **URL helper** — a single `resolveAvatarUrls(paths)` chokepoint
   used by `getProfileForSelf` / `getProfileForMember` / `listMembers`.
   It batches cache-miss paths into one `createSignedUrls` call and
   caches each signed URL keyed by object path with an expiry near the
   24h TTL; a null `avatarPath` yields `null`. Single-profile callers
   pass a one-element array. One chokepoint keeps a future scheme
   change to a single function.
4. **Upload endpoint** — `POST /api/me/avatar` in `src/server/api.ts`,
   multipart body:
   - Authenticated (existing `requireAuth`).
   - Reject a non-image content type; reject > ~2 MB (defence in depth
     — the client already shrank it).
   - Decode and re-encode with `sharp` to a 1024² WebP; a decode
     failure or absurd source dimensions (decompression-bomb guard)
     rejects the request. The re-encoded blob is the authoritative
     artifact.
   - Upload it to `avatars/<userId>/<uuid>.webp`.
   - `UPDATE profiles SET avatar_url = <new path>` — a single statement,
     safe on the transaction pooler (no `db.transaction`).
   - Delete the member's previous object, if any.
   - Return the new signed `avatarUrl`.
   The write order matters: the object exists before the row points at
   it, and the old object is removed last — so any mid-failure leaves a
   harmless orphan object, never a row referencing a missing file.
5. **Delete endpoint** — `DELETE /api/me/avatar`: null out
   `avatar_path` (and legacy `avatar_url`), remove the object.
6. Remove `avatarUrl` from `EDITABLE_PROFILE_FIELDS` in
   `src/server/profiles.ts`.

### Client

7. **`AvatarUploader`** component (`src/app/profile/`): an avatar
   preview with an "Upload photo" button → file picker → crop modal
   (`react-easy-crop`, circular `cropShape`) → canvas export → POST.
   Shows progress and errors; a "Remove photo" action when one is set.
   It uploads **immediately** on crop-confirm — independent of the
   profile form's Save button (standard social pattern).
8. **`profile-form.tsx`** — drop the Avatar URL `<input>`; mount
   `AvatarUploader` at the top of the form.
9. **`Avatar` component** — swap the raw `<img>` for `next/image`
   (`fill`, `sizes` per call site) and drop the `biome-ignore`. The
   host is now ours, so optimisation and a known host both apply.

### Config / ops

10. **`next.config.ts`** — add `images.remotePatterns`: hosted
    `*.supabase.co` always; local `127.0.0.1:54321` in dev only
    (mirror the existing `isProd` CSP branching).
11. **`supabase/config.toml`** — declare the bucket so the local stack
    and `dev:db:reset` provision it:
    ```toml
    [storage.buckets.avatars]
    public = false
    file_size_limit = "2MiB"
    allowed_mime_types = ["image/webp"]
    ```
12. **Hosted Supabase** — create the same `avatars` bucket (private,
    2 MiB, `image/webp`) in the dashboard. Document it in
    `docs/doc-supabase.md`.
13. **Env var** — add `SUPABASE_SECRET_KEY` (server-only; follows the
    existing `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY` naming).
    `scripts/setup.mjs` writes the local value into `.env.local`; the
    hosted value goes into Vercel project env.
14. **CSP** — `img-src` already allows `https:`, so display needs no
    change. The browser only POSTs the upload to `/api/*` (`'self'`),
    so `connect-src` is unaffected.

## Requirements worth calling out

- **EXIF / privacy** — canvas re-encode strips EXIF, including GPS.
  Free, and a real win.
- **Image orientation** — load the source via `createImageBitmap` so
  the browser applies EXIF orientation before cropping; otherwise
  phone photos crop sideways.
- **Mobile memory** — a large phone photo (40–50 megapixels is normal)
  decoded straight into a `<canvas>` can OOM a low-end device. Pass
  `resizeWidth`/`resizeHeight` to `createImageBitmap` so the source is
  bounded before it reaches the canvas.
- **HEIC** — iPhone photos are often HEIC. Non-Safari browsers can't
  decode HEIC in a canvas. Start with `accept="image/png,image/jpeg,image/webp"`
  on the file input and a clear error if decode fails; add a
  `heic2any`-style decode shim only if it actually bites members.
- **Size guard** — client shrinks before upload; the endpoint and the
  bucket both cap size independently, so a crafted request can't
  bypass it.
- **Orphan cleanup** — replace deletes the old object; delete removes
  it. Account deletion isn't a flow that exists yet — when it lands it
  should also clear the member's `avatars/<userId>/` prefix (note for
  whoever builds it).
- **Accessibility** — the crop modal must be keyboard-operable and
  focus-trapped (Base UI `Dialog` already in the stack); the displayed
  avatar's `alt` follows the existing `Avatar` convention (empty when a
  visible name sits beside it).
- **Seed data** — give the seeded e2e users an avatar so the upload
  *and* the already-set state both have e2e coverage.

## Testing

- **Functional** (Vitest, server project) — the local stack already
  runs Storage, so tests hit it for real: happy-path upload sets
  `avatar_path` and returns a URL; non-image rejected; oversize
  rejected; unauthenticated rejected; replace removes the prior
  object; delete clears the column.
- **E2E** (Playwright) — `setInputFiles` on the picker, confirm the
  crop with the default framing, assert the avatar renders on the
  profile and members pages. Precise crop-drag interaction isn't worth
  automating.
- `npm test` (full functional + e2e) before the PR.

## Suggested PR shape

A single PR — schema property rename, upload + delete endpoints,
`resolveAvatarUrls`, the `AvatarUploader`, the `Avatar` / `next.config`
changes, and the bucket + env provisioning. There is no contract PR:
decision 4 needs no data migration, and the cosmetic SQL column rename
rides the separate pending-rename batch. Devjournal entry records the
#136 fix and the private-bucket / signed-URL / Hono-upload decisions.

## Out of scope

- Supabase Pro image transformations — deliberately not a dependency;
  `next/image` covers display sizing.
- A separate thumbnail size — single 1024² master for now; revisit only
  if the `/myweb` graph proves heavy.
- Animated avatars, GIFs — WebP still frame only.
- Moderation / reporting of avatar content — a trust-and-safety
  question for the group, not this PR.
- Avatar history / revert — replace is destructive by design.
