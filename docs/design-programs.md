# Design — Programs

Status: the model and lifecycle sections describe programs as built (#139, #166, #226, #280). Program features: designed 2026-10-30, not yet built. Author: James and Claude.

## Vocabulary

- **Program** — a named offering members join: a call series, a pod cohort, a newsletter.
- **Participant** — a member with a current membership in a program. "Members" means IS Web members generally.
- **Program feature** — functionality that exists only for the participants of the programs it is attached to.

## Data model

### `programs`

| Column | Meaning |
| --- | --- |
| `slug` | Unique URL key (`/programs/[slug]`). Admins can edit it, so program features key on program IDs. |
| `name`, `blurb`, `description` | Display copy; `blurb` and `description` are markdown (`docs/design-richtext.md`). |
| `archivedAt` | Set = hidden from members. Member-facing reads treat an archived program as `not_found`; admins still see it at `/admin/programs`. |
| `signupsOpen` | Gates self-serve join. Defaults to `false` so a new program accepts no joins until an admin opens it. Admin add-participant ignores it. |
| `buttondownTag` | Buttondown tag this program's membership mirrors to; `NULL` = not synced (`docs/design-buttondown.md`). |

### `profile_programs`

Soft-deleted membership. A row means "was ever joined"; `leftAt IS NULL` means currently joined. `assignedAt` is set on first insert and never updated, so it survives leave/rejoin as the stable first-joined date. Member counts, rosters, and every access check use current rows only.

## Lifecycle

- **Create and edit** — admins at `/admin/programs`, with a per-program page for editing fields and adding/removing participants.
- **Join and leave** — members self-serve on `/programs` and `/programs/[slug]` via `POST /api/programs/:id/join` and `/leave`. Join requires `signupsOpen`; an archived program returns `not_found`.
- **Auto-subscribe** — new members are enrolled in `AUTO_SUBSCRIBE_SLUGS` (`weekly-web-updates`) on first sign-in.
- **Onboarding** — the welcome flow's programs step (`docs/design-welcome.md`).
- **Archive** — hides the program and its features from members; data stays, and unarchiving restores both.
- **Delete** — allowed only while the program has no current participants; the FK cascade removes past memberships.

## Program features

### Definition and attachment

A program feature has two halves:

- **Definition (code)** — a registry entry per feature key: the key, a display name, and an optional home card (title, description, href). The feature's own code (program-page section, pages, API routes, tables) lives with the feature and is looked up by key.
- **Attachment (data)** — which programs have which features:

```ts
export const programFeatures = pgTable(
  "program_features",
  {
    programId: uuid("program_id")
      .notNull()
      .references(() => programs.id, { onDelete: "cascade" }),
    featureKey: text("feature_key").notNull(),
    attachedAt: timestamp("attached_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.programId, table.featureKey] })],
).enableRLS();
```

A row means attached. Detaching deletes the row and leaves the feature's data in place, so reattaching restores it. Rows whose key is missing from the registry are ignored, so retiring a feature from code needs no data step first.

Attachments live in the database because a feature can attach to several programs, and code has no stable per-environment handle on a program: prod IDs are random UUIDs and slugs are editable.

Admins attach and detach features on `/admin/programs/[id]`, which lists every registry feature with a toggle, backed by `PUT` and `DELETE /api/admin/programs/:id/features/:key`. The admin UI ships with the first feature. `scripts/seed-dev.json` attaches features to seed programs locally.

### Access rule

A feature is available to active participants of the active (unarchived) programs it is attached to. Admins get no bypass.

One server helper in `src/server/program-features.ts` owns this rule. The home page, the program page, and every feature API route call it, so the UI and the API can't disagree.

- **API** — feature routes live under `/api/programs/:id/<feature-key>/…` behind a shared middleware that applies the rule for that key and `:id`. A feature that isn't attached, or an archived program, returns `404 not_found` (matching the existing archived handling); an attached feature with a non-participant caller returns `403 not_participant`.
- **Pages** — a feature page's existence is public. A non-participant who opens one sees that it is for participants, with a link to the program page.

### Where features appear

- **Program-page section** — a section on `/programs/[slug]`, rendered for participants.
- **Standalone page** — a route the feature chooses, with a card in a "Your programs" section of the home page for members who have access through any program. A standalone page for a feature attached to several programs scopes its data per program and decides how a member of more than one picks between them.
- **Admin tools** — under `/admin`, behind `requireAdmin` and outside the participant gate (moderation, for example).

### Data tables

Each feature owns its tables, prefixed with the feature name (`message_box_…`). A feature that can attach to more than one program carries a `program_id` FK to `programs`; a single-program feature may omit it. Schema changes follow expand-contract (`docs/strategy-committing.md`) and run through `prod:db:expand` before the code that uses them lands.

### Rendering

The program page server-renders feature sections with the prefetch-and-hydrate pattern `/myweb` uses (`src/app/myweb/page.tsx`):

- `page.tsx` fetches the program server-side, including the features the caller can use.
- Each feature renders as an async Server Component inside its own `<Suspense>`. It prefetches its initial data into a `QueryClient` and wraps its client components in `HydrationBoundary`, so their `useQuery` calls mount on a warm cache.
- Sections fetch in parallel on the server and stream into the document response. A slow section delays only itself.
- `ProgramSlugDetail` hydrates the same way. The page is client-rendered today; it moves to server rendering with the first feature.

The home page gets the caller's features from `GET /me`, which runs the feature query in parallel with the profile read.

### Performance

- The registry is a static module: no per-request cost, and since it holds no components, importing it ships no feature code.
- The access query is an indexed join over small tables; its cost is the round trip to the pooler.
- Every `serverApiClient` call runs `requireAuth`, which calls `supabase.auth.getUser()` — a network round trip to Supabase Auth. Feature lookups therefore ride on calls a page already makes (`/me`, `programs/by-slug`), and feature API routes fold the access check into, or run it alongside, their own query. A program page with N sections makes N Auth calls in parallel, which is fine at current scale.

## Open questions

- **Feature data on program delete.** `deleteProgram` is allowed with no current participants. A cascading FK deletes a feature's data with the program; a restricting FK makes the delete fail with an FK error `deleteProgram` doesn't map yet. Decide with the first feature table.
