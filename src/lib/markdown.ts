// Prose typography shared by the read-side renderer (<Markdown>) and the
// editor's content area, so the WYSIWYG editor matches the rendered output —
// headings, list markers, and link colours all come from @tailwindcss/typography
// (themed in globals.css), which the app's Tailwind preflight would otherwise
// strip from both surfaces. Serif body, sans headings.
export const PROSE_CLASSNAME = "prose max-w-none font-serif prose-headings:font-sans";

// Returns true when markdown source renders to some visible text. Used to
// validate "required" rich-text fields: a WYSIWYG editor a user has touched
// and cleared can still serialize to whitespace or bare structural markup
// ("\n", "**  **", "###"), so we check for rendered content rather than raw
// string length. The render path has no raw-HTML support, so any literal HTML
// (e.g. "<br>") shows as text and counts as content — we strip only markdown
// structural/emphasis punctuation and whitespace. See docs/design-richtext.md
// (Required-field empty state).
export function markdownHasContent(markdown: string): boolean {
  const stripped = markdown.replace(/[#>*_~`+\-[\]()!|]/g, "").replace(/\s+/g, "");
  return stripped.length > 0;
}
