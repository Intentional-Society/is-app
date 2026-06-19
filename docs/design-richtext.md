# Design — Rich text

Status: implemented 2026-06-18 against MDXEditor 4.0.3. Author: collaborative interview between James and Claude. Tracks #432.

This is a design doc — concrete decisions, with rationale for future-us. It sits below `architecture-appstack.md` and above the code.

## Purpose

Program descriptions are authored as plain text and rendered raw, so paragraph breaks and spacing collapse on the public program page (`programs.description`, shown in `src/app/programs/[slug]/program-slug-detail.tsx`). Authors want to write something that reads like a real page — paragraphs, emphasis, lists, links — and have it look that way. This document fixes how the app **stores, renders, and authors** formatted text — across program copy (the urgent #432 case) and member-authored prose.

## The shape of the decision

Two axes, decided independently:

1. **Storage format** — what bytes live in the `text` column. → **Markdown.**
2. **Authoring UX** — what the author interacts with. → **WYSIWYG (MDXEditor), markdown hidden.**

Keeping these separate matters: a WYSIWYG editor does not imply HTML storage. We deliberately pair a WYSIWYG surface with markdown persistence.

## Formatting set (v1)

Confirmed 2026-06-18. Every item is standard markdown (CommonMark + GFM) and renders through `react-markdown` with no raw HTML and no sanitizer — the toolbar exposes exactly this set and no more:

- Paragraphs and line breaks (see [Line breaks](#line-breaks))
- **Bold** and *italic*
- ~~Strikethrough~~ (GFM)
- Bullet and numbered lists
- Links
- Block quotes
- Headings — **h3–h4 only**. The editor authors them as literal `###`/`####`, which `react-markdown` renders as `<h3>`/`<h4>` verbatim — no render-side level remapping (markdown is hidden, so there is no shallower authored heading to shift). The pages that render this prose use h2 for their own title, so starting authored headings at h3 keeps them correctly nested under the page title in the document outline. h5+ is left out deliberately: at that depth a heading reads as bold body text, adding no real hierarchy — trivially re-enabled via the editor's allowed-levels config if a need appears

`blurb` carries an **inline-only** subset of the above (bold, italic, strikethrough, links — no headings, lists, or quotes), because it renders in the tight space of a list card.

Each maps to an MDXEditor plugin (`headingsPlugin`, `listsPlugin`, `linkPlugin`, `quotePlugin`, plus `remark-gfm` for strikethrough).

**Deliberately out of v1:**

- **Underline** — there is no markdown for it; MDXEditor emits raw `<u>` HTML, which would (a) force `rehype-raw` + a sanitizer back into the render path we keep clean, and (b) hit bug [#200](https://github.com/mdx-editor/editor/issues/200) (breaks adjacent to `<u>` are dropped). It also reads as a link, given we have real links. **Deferred, not refused** — if real demand appears, revisit via a tightly allowlisted `<u>`-only `rehype-sanitize` config.
- Images, tables, code blocks, and raw HTML — not needed for program descriptions at v1.

Keeping underline and raw HTML out is what lets the render path stay sanitizer-free (see [Security model](#security-model)).

## Storage: markdown in the existing `text` columns

User-authored prose is stored as **Markdown source text** in the columns it already occupies. `programs.description` is already `text` (unlimited); markdown is just text, so **there is no schema migration** — only a change in how we interpret and render the bytes.

Why markdown over an HTML subset or editor-specific JSON:

- **Safety by construction.** Markdown rendered without raw-HTML support cannot carry script. An HTML-subset column would store whatever bytes are written, including `<script>`/`<img onerror=…>`, forcing a sanitizer (DOMPurify/sanitize-html) on every render and a `dangerouslySetInnerHTML` call — one mistake is a stored XSS hitting every viewer. See [Security model](#security-model).
- **Portable and diffable.** Markdown is human-readable, editor-agnostic, and survives a future editor swap. Editor-specific JSON couples the stored data to one library.
- **No DB-level change.** The column type, length, and nullability are untouched.

Rich text applies to `programs.description` and `programs.blurb` (the latter inline-only — see [Formatting set](#formatting-set-v1)), plus the member-prose fields `profiles.bio`, `currentIntention`, and `supplementaryInfo`. These are already `text` columns and stay so. Whatever length limit each field carries today is a separate per-field product decision that this design neither sets nor changes — markdown is just text, so existing caps keep applying to the source bytes untouched.

## Render: `react-markdown`, no raw HTML

Rendering uses **`react-markdown` + `remark-gfm` + `remark-breaks`**, with **no `rehype-raw`**.

- `react-markdown` parses markdown to an AST and builds a React element tree directly. It never uses `dangerouslySetInnerHTML` and does not render embedded raw HTML unless `rehype-raw` is enabled — so it is XSS-safe with no separate sanitizer.
- `remark-gfm` adds the GitHub-flavored extras (tables, strikethrough, task lists, autolinks). The toolbar only authors strikethrough and links (autolinks just make a bare URL clickable), but the full `<Markdown>` renderer is deliberately **left unconstrained**: if legacy or pasted source happens to contain a table or `- [ ]` checkbox it renders as one. That is harmless layout, not a security concern (still no raw HTML), and authors are trusted, so we do not pin `allowedElements` here. The constrained-inline card variant is the one exception, and it allowlists for layout, not safety (see [Cards](#cards-and-other-constrained-surfaces)).
- `remark-breaks` turns a bare single `\n` into a line break (`<br>`). MDXEditor writes a Shift+Enter as a soft `\n`, and legacy plain-text descriptions carry their breaks the same way, so without it those breaks would collapse to spaces (see [Line breaks](#line-breaks)).
- **`rehype-raw` is the one thing we do not add** — it is the only path that reintroduces raw-HTML execution and would drag in DOMPurify + CSP work for no benefit here.
- Styling: `@tailwindcss/typography` (`prose` classes) — a new dependency, enabled with one `@plugin "@tailwindcss/typography";` line in `globals.css` — themed to the app's serif look, so headings/lists/links inherit the existing tokens rather than browser defaults.

A single shared `<Markdown>` component wraps this, used everywhere formatted prose is displayed.

### Cards and other constrained surfaces

The programs list card shows `blurb`, falling back to `description` when blurb is empty (`src/app/programs/programs-list.tsx`). Cards **render markdown too**, in a **constrained inline variant** of `<Markdown>`: it keeps inline marks (emphasis, strikethrough, links), line breaks, and paragraphs — each paragraph rendered as a plain block line so the author's line breaks survive — while *unwrapping* the blowout-prone blocks (headings, lists, quotes) to their text. This shows the formatting and line breaks without letting a full description's heading sizes or list markers blow out the card layout — and it is still raw-HTML-free, since it uses `react-markdown`'s element allowlist (`allowedElements` + `unwrapDisallowed`), not a sanitizer. The same constrained renderer covers any future inline surface.

### Line breaks

In a WYSIWYG editor the author never types newline characters — they press **Enter** for a new paragraph or **Shift+Enter** for a line break within one. MDXEditor serializes these as:

- **Enter** → a blank line (`\n\n`) → separate `<p>`s.
- **Shift+Enter** → a *soft* single `\n`. The editor shows it as a line break (its content area is `white-space: break-spaces`), and import is symmetric: a stored `\n` reads back as that same break.

A bare `\n` is what CommonMark collapses to a space, so **`remark-breaks`** is in the render pipeline (both the full and constrained-inline variants) to turn each one into a `<br>`. Editor, stored bytes, and rendered page then agree, and the same rule renders the breaks in legacy plain-text descriptions — so fixing the #432 collapse needs no data migration.

Underline is deliberately off, which also sidesteps MDXEditor bug [#200](https://github.com/mdx-editor/editor/issues/200) (Shift+Enter breaks adjacent to `<u>` are dropped).

## Authoring: MDXEditor (WYSIWYG, markdown invisible)

Authors get a **true WYSIWYG** surface — formatting appears as they type and they never see markdown syntax. The chosen widget is **[MDXEditor](https://mdxeditor.dev/)** (`@mdxeditor/editor`).

Why MDXEditor specifically, given markdown storage:

- **Markdown is its native format.** MDXEditor reads markdown in and writes markdown out as its document model, so the round-trip is *faithful* — what we store is exactly what it parsed, with no second serialization to maintain and nothing silently dropped.
- **It hides markdown entirely**, satisfying the "everyone is unaware it's markdown under the hood" requirement.
- **MIT-licensed**, actively maintained (~793K weekly npm downloads as of 2026-06-18).

**Paste keeps formatting:** pasted rich content (from a doc or web page) is converted to the supported markdown subset; anything outside the set degrades to plain text rather than being preserved as raw HTML.

**Required-field empty state:** an editor a user has touched and cleared can still serialize to non-empty whitespace or empty markup, so a required field (member `bio` is the only one today) gates "Save" on the rendered output being non-empty, not on the markdown string having length.

The candidates were the WYSIWYG-over-markdown editors:

| Editor | Weekly npm (2026-06-18) | License | Markdown round-trip | Notes |
|---|---|---|---|---|
| **MDXEditor** (chosen) | ~793K | MIT | **Faithful** — markdown is the model | Built on Lexical; heavier bundle (mitigated by lazy-load) |
| Tiptap + `tiptap-markdown` | ~10.2M | MIT (OSS core) | Lossy export — md is a serialization | Far most popular, but that popularity is for apps storing ProseMirror JSON, not markdown |
| BlockNote | ~353K | MPL-2.0 (XL pkgs GPL-3.0) | Lossy export | Polished Notion-style block UX; licensing wrinkle |
| Milkdown / Crepe | ~210K | MIT | Faithful (markdown-native) | Honourable mention; smaller community, more UI assembly |

The decisive axis is **round-trip fidelity**, not raw popularity. Tiptap's and BlockNote's native models are document trees with markdown as an *export*; pairing them with markdown columns means owning a lossy serializer that can normalize or drop constructs across edit/save cycles. MDXEditor (and Milkdown) make markdown the source of truth, removing that whole class of bug. Tiptap remains the right answer when you store *its* JSON — which we are not.

### Bundle weight

MDXEditor is built on Lexical and is not small. It is **lazily loaded** (`next/dynamic` with `ssr: false` — Lexical is client-only) **in every authoring surface** — the admin program editor *and* the member-facing profile/onboarding forms — and **never ships to a render-only page** (public program detail, member profile, list cards), which need only `react-markdown`. The render path and the authoring path have entirely separate dependency footprints. Member prose is authored on bundle-sensitive member routes — including onboarding — so the dynamic import matters there as much as in admin: the editor chunk is fetched only when an author actually mounts the form, never on a first paint that only displays prose.

## Security model

- **No `dangerouslySetInnerHTML`** anywhere in the render path — preserves the app's current accidental-XSS-safety as a deliberate property.
- **No `rehype-raw`** — raw HTML embedded in markdown is rendered as literal text, not executed.
- **Link safety** — `react-markdown` blocks dangerous URL protocols (`javascript:` etc.) by default; we keep that. Links open in the **same tab** (default navigation), and any `http(s)`/`mailto` URL is allowed — no domain allowlist.
- No separate sanitizer is required precisely because we never accept raw HTML.

## Scope and rollout

v1 covers **both** program copy and member prose, on one shared `<Markdown>` renderer (full + constrained-inline variants) and one shared lazy-loaded MDXEditor (full + inline-only configs):

- **Program copy** — `description` (full formatting) and `blurb` (inline only), authored on the admin edit page (`src/app/admin/programs/[id]/program-detail.tsx`) and the create form (`programs-admin.tsx`, which also uses the full editor for `description` so the create path never silently stores raw markdown from a plain textarea); rendered on the detail page (`program-slug-detail.tsx`) and, constrained, on list cards (`programs-list.tsx`).
- **Member prose** — `bio`, `currentIntention`, `supplementaryInfo` (`src/components/profile-fields.tsx`, rendered in `src/app/members/[id]/page.tsx`).

Suggested build order *within* v1: land the shared components against program `description` first (highest-trust authors, the urgent #432 case), then wire `blurb` and the member-prose fields in the same release. Storage is unchanged throughout, so every step is additive — render + editor wiring, no migration.

## Implementation notes

- **No legacy migration.** `remark-breaks` renders existing bare-newline descriptions with their breaks intact, so the renderer already agrees with the editor. Re-saving through the editor is optional cleanup, not a prerequisite.
- **The editor is true WYSIWYG.** Its content area carries the same `prose` typography as the renderer (`PROSE_CLASSNAME` in `src/lib/markdown.ts`), so headings, list markers, and link colour look identical in the editor and on the rendered page — the app's Tailwind preflight strips the browser defaults MDXEditor would otherwise rely on.
- **Theme.** `prose` is themed by pointing the `--tw-prose-*` variables at the app tokens in `globals.css` (body/headings → `--foreground`, links → `--primary`, bullets/counters → `--muted-foreground`, quote border → `--border`), so it inherits the serif body + sans headings and flips with `.dark` without `prose-invert`. Adding the `@plugin "@tailwindcss/typography"` line needs a one-time `.next` clear in dev — Turbopack won't hot-load a newly added plugin; production builds are unaffected.
- **Toolbar fits narrow forms.** The toolbar wraps instead of scrolling and the block-type select is trimmed, so the full editor fits the `max-w-md` profile forms (`.is-mdxeditor` rules in `globals.css`).
- **Strikethrough** is a toolbar toggle. Typed `~~…~~` is escaped on export, and per GFM's flanking rule a `~~` adjacent to a space doesn't strike (`~~ x ~~` renders literally) — authors select the words, not the surrounding spaces.
- **Headings** are limited to h3/h4 (`headingsPlugin({ allowedHeadingLevels: [3, 4] })`), which also constrains the block-type dropdown.
- **Field labels.** MDXEditor renders a contenteditable `<div>`, which `<label htmlFor>` can't target, so each editor sets its accessible name via a `translation` override of the `contentArea.editableMarkdown` key — resolving it for screen readers and `getByLabel`.
- **Bundle.** The MDXEditor chunk is imported only by the authoring components (`markdown-editor.tsx` → lazy `markdown-editor-impl.tsx`), never by `markdown.tsx` or a render-only page; `ssr:false` keeps it out of first paint.
