# Admin Role Implementation — Brief for Claude Code

## Context

This document captures all design decisions, architecture, and remaining work for the admin role feature in the Intentional Society app. It is intended to give Claude Code full context to continue implementation without gaps.

---

## What has already been written (do not rewrite)

The following files have been created or modified on the `admin-page` branch:

### New files
- `src/server/programs-admin.ts` — DB functions: `listAdminPrograms`, `createProgram`, `updateProgram`, `deleteProgram`, `listProgramMembers`, `assignMember`, `removeMember`
- `src/server/members-admin.ts` — DB functions: `listAdminMembers`, `setAdminStatus`
- `src/app/admin/layout.tsx` — Admin layout with `requireAdmin()` gate + top nav (Programs, Members links)
- `src/app/admin/page.tsx` — Admin dashboard with two cards linking to /admin/programs and /admin/members

### Modified files
- `src/server/api.ts` — Added `checkAdmin` helper and all admin API routes (see full list below)
- `src/lib/api-server.ts` — Added `requireAdmin()` page-level guard (mirrors `requireUser()`, redirects non-admins to `/`)
- `src/lib/api-types.ts` — Added `AdminProgram`, `AdminProgramMember`, `AdminMember` type aliases inferred from API routes

---

## API routes added to src/server/api.ts

All routes require `isAdmin = true` on the caller's profile (checked via `checkAdmin` helper). Non-admins receive 403.

| Method | Path | Purpose |
|--------|------|---------|
| GET | /api/admin/programs | List all programs with member counts |
| POST | /api/admin/programs | Create a program |
| PUT | /api/admin/programs/:id | Update name / description / slug |
| DELETE | /api/admin/programs/:id | Delete program (guard: 409 if members exist) |
| GET | /api/admin/programs/:id/members | List members of a program |
| POST | /api/admin/programs/:id/members | Assign a member to a program |
| DELETE | /api/admin/programs/:id/members/:profileId | Remove a member from a program |
| GET | /api/admin/members | List all members with isAdmin flag |
| PATCH | /api/admin/members/:id/admin | Grant or revoke admin status |

---

## What still needs to be built

### 1. src/app/admin/programs/page.tsx + programs-admin-panel.tsx

Server page calls `requireAdmin()` and fetches programs via `serverApiClient.api.admin.programs.$get()`, passing data to the client panel.

The client panel (`programs-admin-panel.tsx`, `"use client"`) handles:

**Program list:**
- Table/list of all programs: name, slug, member count, active status, created date
- Inactive programs should be visually dimmed (e.g. `opacity-50` or a grey "Inactive" badge)
- "New program" button that shows an inline create form
- Each row has Edit and Delete buttons

**Create form (inline, shown on demand):**
- Name field (required) — slug auto-populates as user types, editable
- Description field (optional textarea)
- Slug field — pre-filled from name, user can override; show warning text "Changing the slug will break existing links" when slug differs from the auto-generated version
- `is_active` toggle (default on) — controls visibility on the member-facing /programs page
- Submit → POST /api/admin/programs
- `created_by` is set server-side from `user.id`, not shown in the form

**Edit (inline, replaces row on click):**
- Same fields as create, pre-filled with current values (including the `is_active` toggle)
- Submit → PUT /api/admin/programs/:id

**Delete:**
- Uses `window.confirm` (same pattern as invites revoke)
- DELETE /api/admin/programs/:id
- If API returns 409 `has_members`, show error: "Cannot delete — this program has {memberCount} member(s). Remove them first."
- On success, remove from list

**Member management (expanded row, accordion-style below each program row):**
- Clicking a "Members" button on a program row expands a section directly below it
- Keeps program context visible while managing members — no navigation needed
- List current members of that program with a Remove button per row
- A search input below the current members filters all members not yet in the program by display name
  - Fetch all members from GET /api/admin/members when first expanded (cached for the session)
  - Clicking a filtered member assigns them → POST /api/admin/programs/:id/members
  - Remove → DELETE /api/admin/programs/:id/members/:profileId

### 2. src/app/admin/members/page.tsx + members-admin-panel.tsx

Server page calls `requireAdmin()` and fetches members via `serverApiClient.api.admin.members.$get()`, passing data to the client panel.

The server page must pass `currentUserId={me.id}` (from `requireAdmin()` return value) as a prop to the panel, so the panel can identify and disable the current user's own toggle row.

The client panel (`members-admin-panel.tsx`, `"use client"`) handles:

**Member list:**
- Table/list of all members: avatar, display name, location, admin badge
- Each row has a toggle button: "Make admin" / "Remove admin"

**Admin toggle behaviour:**
- Calls PATCH /api/admin/members/:id/admin with `{ isAdmin: true/false }`
- If API returns 403 `self_demotion`: show error "You cannot remove your own admin status."
- If API returns 409 `last_admin`: show error "Cannot remove the last admin."
- The toggle button for the current user's own row should be visually disabled with title tooltip "You cannot remove your own admin access" — but the API also enforces this as a hard guard.
- On success, update the row in local state (no full reload needed)

### 3. src/components/site-header.tsx

Add `isAdmin` prop (boolean) to `SiteHeader`.

Add an Admin link inside the Sheet nav, visually distinct from the other links:
- Use the `Shield` icon from `lucide-react` (already imported: `Menu` is used; add `Shield` to the import)
- Style it differently from regular nav items to signal it is a power-user area — e.g. slightly different color or a divider above it
- Only render if `isAdmin === true`
- Link to `/admin`

Example:
```tsx
{isAdmin && (
  <>
    <div className="my-1 border-t border-border" />
    <SheetClose
      nativeButton={false}
      render={
        <Link
          href="/admin"
          className="flex items-center gap-2 rounded px-2 py-2 font-medium text-primary hover:bg-muted"
        >
          <Shield className="h-4 w-4" />
          Admin
        </Link>
      }
    />
  </>
)}
```

### 4. src/app/layout.tsx

Pass `isAdmin` to `SiteHeader`. The `me` object is already fetched here. Change:

```tsx
<SiteHeader displayName={me?.profile?.displayName ?? null} />
```

to:

```tsx
<SiteHeader
  displayName={me?.profile?.displayName ?? null}
  isAdmin={me?.profile?.isAdmin ?? false}
/>
```

---

## Design decisions (all confirmed)

### Authorization
- Single `isAdmin` boolean on `profiles` table — no roles table needed
- `checkAdmin` helper in `api.ts` gates every `/api/admin/*` route
- `requireAdmin()` in `api-server.ts` gates every admin page server-side (non-admins never receive the page HTML)

### Admin self-demotion guard
- API (`setAdminStatus`) rejects `self_demotion` with 403
- UI disables the toggle on the current user's own row with a tooltip
- API also rejects `last_admin` with 409 — the last admin cannot be removed

### Program deletion guard
- API returns 409 `has_members` (with `memberCount`) instead of cascading
- UI shows the member count in the error message and instructs the admin to remove members first
- Note: `profilePrograms` has `ON DELETE CASCADE` in the schema, so if you ever want to change this to cascade, just remove the guard check in `deleteProgram`

### Slug policy
- Auto-generated from program name on creation (`programSlug` helper in `programs-admin.ts`)
- Admin can override the slug manually in the form
- On edit: show a warning if the slug differs from the auto-generated version ("Changing the slug will break existing links")
- If an auto-generated slug on rename conflicts with an existing program, the existing slug is preserved (handled in `updateProgram`)

### Request body schemas

**POST `/api/admin/programs`** (create):
```ts
{ name: string; slug?: string; description?: string; isActive?: boolean }
```
- `slug` auto-generated from name if omitted
- `isActive` defaults to `true` server-side if omitted
- `created_by` is set server-side from `user.id`, not in the body

**PUT `/api/admin/programs/:id`** (update, all fields optional):
```ts
{ name?: string; slug?: string; description?: string | null; isActive?: boolean }
```

**PATCH `/api/admin/members/:id/admin`**:
```ts
{ isAdmin: boolean }
```

### Sort order

- `listAdminPrograms`: `createdAt DESC` (newest first)
- `listAdminMembers`: `createdAt DESC` (newest first)
- Member-facing `listPrograms`: `name ASC` (unchanged)

### Slug conflict error handling

For both POST and PUT: if the submitted slug is already taken by another program, the API returns `409 slug_taken`. The UI shows an inline error directly below the slug field: **"This slug is already in use by another program."** This is distinct from the slug-change advisory warning (which is informational, shown whenever slug ≠ auto-generated form).

### Schema migration required

Two columns were added to the `programs` table. Run these before testing:

```bash
npx drizzle-kit generate   # generates the SQL migration file
npx drizzle-kit migrate    # applies it to your local DB
```

The schema changes (already in `src/server/schema.ts`):

- **`is_active` (boolean, default true)** — soft-hides a program from the member-facing `/programs` page without deleting it. The member-facing `listPrograms` in `programs.ts` already filters to `is_active = true` (confirmed: `programs.ts:44`). The admin view (`listAdminPrograms`) returns all programs regardless.
- **`created_by` (UUID FK → profiles, on delete set null)** — tracks which admin created the program. Stored automatically from `user.id` when POST /api/admin/programs is called.

### RLS (important non-issue)
- All tables have RLS enabled with deny-by-default
- Drizzle connects as the `postgres` superuser which bypasses RLS entirely
- No RLS policy changes are needed for admin writes — this was confirmed by reading the schema comments

### Nav placement
- Admin link lives in the slide-out Sheet menu (hamburger, top-right)
- Visually distinct from regular nav links: `Shield` icon + primary color + divider above
- Only visible to users where `isAdmin === true`
- One click from anywhere → `/admin`
- `SheetClose` API confirmed: uses `nativeButton={false}` and `render={<Link …/>}` — matches existing pattern in `site-header.tsx`

---

## Existing patterns to follow

- Client components use `useState` + `useCallback` + `useEffect` for data loading (no TanStack Query yet — see comment in invites-panel.tsx)
- API calls use `apiClient` from `@/lib/api` on the client, `serverApiClient` from `@/lib/api-server` on the server
- Destructive confirmations use `window.confirm` (see `confirmRevoke` in invites-panel.tsx)
- Error states use `{ kind: "idle" | "saving" | "error"; message?: string }` pattern
- UI components: `Button`, `Label`, `Textarea` from `@/components/ui/`
- Tailwind CSS v4 for styling, follow existing class patterns

---

## Future work (not in scope for this PR)

- Admin-issued invites: create invite with `creatorValue: null` from admin UI; view and revoke all invites (not just own)
- Member profile detail view: full profile visible to admins, reserved space for account deactivation
- Hint seeding: admin surface for seeding the relations graph (documented in `docs/design-relations.md`)
- E2E tests: `e2e-admin@testfake.local` test user already exists; tests should cover: non-admin redirect, program CRUD, member admin toggle

---

## Running the app

```bash
npm run dev       # starts local Supabase + Next.js dev server
npm run lint      # Biome linter
npm test          # all tests
```

To promote a user to admin for local testing, run in Supabase Studio (localhost:54323):
```sql
UPDATE profiles SET is_admin = true WHERE id = '<user-uuid>';
```
