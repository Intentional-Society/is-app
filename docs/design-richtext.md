# Design — Rich text

Status: design captured 2026-06-18. Not yet implemented. Author: collaborative interview between James and Claude. Tracks #432.

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

- Paragraphs and line breaks (see [Line breaks](#line-breaks-let-the-editor-own-them-normalize-legacy-once))
- **Bold** and *italic*
- ~~Strikethrough~~ (GFM)
- Bullet and numbered lists
- Links
- Block quotes
- Headings — scoped to sub-page levels (h2–h4) so authored headings nest under the page's own title rather than competing with it

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

Rich text applies to `programs.description` and `programs.blurb` (the latter inline-only — see [Formatting set](#formatting-set-v1)), plus the member-prose fields `profiles.bio`, `currentIntention`, and `supplementaryInfo`. **No length cap** is imposed on any of them — the `text` columns stay unlimited; authors are members and admins, not the public.

## Render: `react-markdown`, no raw HTML

Rendering uses **`react-markdown` + `remark-gfm`**, with **no `rehype-raw`**.

- `react-markdown` parses markdown to an AST and builds a React element tree directly. It never uses `dangerouslySetInnerHTML` and does not render embedded raw HTML unless `rehype-raw` is enabled — so it is XSS-safe with no separate sanitizer.
- `remark-gfm` adds the GitHub-flavored extras (tables, strikethrough, task lists, autolinks).
- **`rehype-raw` is the one thing we do not add** — it is the only path that reintroduces raw-HTML execution and would drag in DOMPurify + CSP work for no benefit here.
- Styling: `@tailwindcss/typography` (`prose` classes), themed to the app's serif look, so headings/lists/links inherit the existing tokens rather than browser defaults.

A single shared `<Markdown>` component wraps this, used everywhere formatted prose is displayed.

### Cards and other constrained surfaces

The programs list card shows `blurb`, falling back to `description` when blurb is empty (`src/app/programs/programs-list.tsx`). Cards **render markdown too**, in a **constrained inline variant** of `<Markdown>`: it allows only inline nodes (emphasis, strikethrough, links) and *unwraps* block nodes (headings, lists, quotes) to their text, then CSS line-clamps. This shows the formatting without letting a full description's block elements blow out the card layout — and it is still raw-HTML-free, since it uses `react-markdown`'s element allowlist (`allowedElements` + `unwrapDisallowed`), not a sanitizer. The same constrained renderer covers any future truncated surface.

### Line breaks: let the editor own them, normalize legacy once

In a WYSIWYG editor the author never types newline characters — they press **Enter** (new paragraph → `\n\n`) or **Shift+Enter** (line break → a CommonMark *hard* break). MDXEditor emits *explicit* markdown for both, and both render intuitively through `react-markdown` **with no `remark-breaks`**. The intuitive behaviour comes from the editor, not from a render-time plugin.

`remark-breaks` (turn every bare single `\n` into a break) is deliberately **not** our mechanism:

- MDXEditor normalizes whitespace on import/export and its maintainer treats blank-line/whitespace preservation as "against the markdown idea" ([#112](https://github.com/mdx-editor/editor/issues/112)). Injecting `remark-breaks` into its pipeline is friction, and export rewrites bare newlines to explicit hard breaks regardless — so it would not round-trip as remark-breaks-style soft newlines.
- `remark-breaks` on the **render side only** would make the public page and the editor *disagree* about any content containing bare newlines (page shows breaks; editor collapses them on import) — the WYSIWYG lie we are trying to avoid.

That leaves one real job: **legacy plain-text descriptions** with bare single newlines. Fix them with a **one-time normalization** (bare `\n` → paragraph or hard break) so renderer and editor agree from then on. The dataset is a handful of admin-managed programs, so this is trivial — re-saving each through the new editor once is itself a valid normalization. After that the stored format is uniform explicit-break markdown and no render-time plugin is needed. (`remark-breaks` may be kept as a harmless belt for stray bare newlines on the public page, but it is not a substitute for normalization — it does not fix the editor's view of legacy content.)

**Verify in the prototype:** that MDXEditor serializes a Shift+Enter as a *standard* CommonMark hard break (backslash or two trailing spaces), which `react-markdown` renders natively — **not** a literal `<br>`, which the no-`rehype-raw` path would print as text. Also note open bug [#200](https://github.com/mdx-editor/editor/issues/200): Shift+Enter breaks adjacent to underline (`<u>`) get dropped — sidestepped by not enabling underline (not standard markdown anyway).

## Authoring: MDXEditor (WYSIWYG, markdown invisible)

Authors get a **true WYSIWYG** surface — formatting appears as they type and they never see markdown syntax. The chosen widget is **[MDXEditor](https://mdxeditor.dev/)** (`@mdxeditor/editor`).

Why MDXEditor specifically, given markdown storage:

- **Markdown is its native format.** MDXEditor reads markdown in and writes markdown out as its document model, so the round-trip is *faithful* — what we store is exactly what it parsed, with no second serialization to maintain and nothing silently dropped.
- **It hides markdown entirely**, satisfying the "everyone is unaware it's markdown under the hood" requirement.
- **MIT-licensed**, actively maintained (~793K weekly npm downloads as of 2026-06-18).

**Paste keeps formatting:** pasted rich content (from a doc or web page) is converted to the supported markdown subset; anything outside the set degrades to plain text rather than being preserved as raw HTML.

The candidates were the WYSIWYG-over-markdown editors:

| Editor | Weekly npm (2026-06-18) | License | Markdown round-trip | Notes |
|---|---|---|---|---|
| **MDXEditor** (chosen) | ~793K | MIT | **Faithful** — markdown is the model | Built on Lexical; heavier bundle (mitigated by lazy-load) |
| Tiptap + `tiptap-markdown` | ~10.2M | MIT (OSS core) | Lossy export — md is a serialization | Far most popular, but that popularity is for apps storing ProseMirror JSON, not markdown |
| BlockNote | ~353K | MPL-2.0 (XL pkgs GPL-3.0) | Lossy export | Polished Notion-style block UX; licensing wrinkle |
| Milkdown / Crepe | ~210K | MIT | Faithful (markdown-native) | Honourable mention; smaller community, more UI assembly |

The decisive axis is **round-trip fidelity**, not raw popularity. Tiptap's and BlockNote's native models are document trees with markdown as an *export*; pairing them with markdown columns means owning a lossy serializer that can normalize or drop constructs across edit/save cycles. MDXEditor (and Milkdown) make markdown the source of truth, removing that whole class of bug. Tiptap remains the right answer when you store *its* JSON — which we are not.

### Bundle weight

MDXEditor is built on Lexical and is not small. It is loaded **only in the admin authoring surface**, lazily — it must never ship to the public program-detail page, which needs only `react-markdown`. The render path and the authoring path have entirely separate dependency footprints.

## Security model

- **No `dangerouslySetInnerHTML`** anywhere in the render path — preserves the app's current accidental-XSS-safety as a deliberate property.
- **No `rehype-raw`** — raw HTML embedded in markdown is rendered as literal text, not executed.
- **Link safety** — `react-markdown` blocks dangerous URL protocols (`javascript:` etc.) by default; we keep that. Links open in the **same tab** (default navigation), and any `http(s)`/`mailto` URL is allowed — no domain allowlist.
- No separate sanitizer is required precisely because we never accept raw HTML.

## Scope and rollout

v1 covers **both** program copy and member prose, on one shared `<Markdown>` renderer (full + constrained-inline variants) and one shared lazy-loaded MDXEditor (full + inline-only configs):

- **Program copy** — `description` (full formatting) and `blurb` (inline only), authored in `src/app/admin/programs/[id]/program-detail.tsx`; rendered on the detail page (`program-slug-detail.tsx`) and, constrained, on list cards (`programs-list.tsx`).
- **Member prose** — `bio`, `currentIntention`, `supplementaryInfo` (`src/components/profile-fields.tsx`, rendered in `src/app/members/[id]/page.tsx`).

Suggested build order *within* v1: land the shared components against program `description` first (highest-trust authors, the urgent #432 case), then wire `blurb` and the member-prose fields in the same release. Storage is unchanged throughout, so every step is additive — render + editor wiring, no migration.

## Open questions

- **Legacy normalization** — confirm the one-time bare-newline normalization for existing descriptions (vs. keeping `remark-breaks` as a render-side belt). See [Line breaks](#line-breaks-let-the-editor-own-them-normalize-legacy-once).
- **Theme integration** — tuning `prose` tokens against the serif type and existing color tokens (`docs/strategy-ui.md`).
- **Measured bundle delta** from MDXEditor in the admin chunk, to confirm lazy-loading keeps it off the public page.
