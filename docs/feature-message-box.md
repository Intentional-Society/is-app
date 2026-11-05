# Feature — Message box

Status: built (#12). The first program feature from `docs/design-programs.md`, which covers the registry, attachment and access rule this feature plugs into.

The first program feature (`message-box`, issue #12): participants leave short messages on the program page, replacing the Google Form used for Community Calls.

- **Tables** — `message_box_settings` (`program_id` PK, `visibility`, `prompt`), `message_box_messages` (`program_id`, `author_id`, `body`, `created_at`).
- **Who can do what** — posting: active participants only (`403 not_participant` otherwise). Reading: any signed-in member when the program's visibility is `members`; admins can always read. `visibility` defaults to `admins` (no settings row means the default), so turning the feature on exposes nothing until an admin opens it. Admins set it on `/admin/programs/[id]`, under the feature's toggle. Deleting is admin-only, from the program page, through `DELETE /api/admin/programs/:id/message-box/messages/:messageId` (so the e2e admin cap in `E2E_ADMIN_READS` applies).
- **E2E admin** — the seeded e2e admin is a real admin row whose credentials run unreviewed branch code, so the message-box read path treats it as a plain member (same cap as `E2E_ADMIN_READS`): no admins-only messages, no hidden or deactivated authors, no moderation.
- **Fresh sections** — feature sections are chosen by the server render, so attaching or detaching a feature shows on the next page load, not live. A failed server load of the program fails the render instead of showing the page without its sections.
- **Dates** — timestamps in server-rendered client components use `LocalTime` (`src/components/local-time.tsx`): UTC on the server and during hydration, the viewer's own locale and zone right after, so hydration never mismatches.
- **Prompt** — each program has an optional markdown `prompt` (max 2,000 characters), edited in the Features panel next to the visibility setting and shown above the textarea to everyone who can see the box, including non-participants and viewers who can't read the messages. Blank means none. For Community Calls it carries the "Won't be there at the next call?" text. The admin form saves both with one "Save changes" button; the `PATCH` itself accepts either key.
- **Limits** — 1,000 characters per message, newest 100 shown. No author edit or delete, and no pagination.
- **Authors** — messages show the author's name and avatar. Messages from deactivated or hidden profiles are filtered out for non-admins.
- **Routes** — `GET`/`POST /api/programs/:id/message-box` (shared middleware, then the rules above); `GET`/`PATCH /api/admin/programs/:id/message-box` for the settings (`visibility`, `prompt`). The member `GET` also returns the `prompt`.
- **Not built** — Miro replication, and a per-program "Program Contact" role (a permissions tier between participant and admin) that could read and moderate its own program's messages.
