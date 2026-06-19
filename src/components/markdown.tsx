import type { ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";

import { PROSE_CLASSNAME } from "@/lib/markdown";
import { cn } from "@/lib/utils";

// remark-gfm adds GFM extras (strikethrough, autolinks, tables); remark-breaks
// turns a bare single "\n" into a hard line break, which is how MDXEditor
// serializes a Shift+Enter and how legacy plain-text descriptions carry their
// line breaks. See docs/design-richtext.md (Line breaks).
const REMARK_PLUGINS = [remarkGfm, remarkBreaks];

type MarkdownProps = {
  children: string;
  className?: string;
};

// Full formatted prose: paragraphs, h3–h4, bullet/numbered lists, block
// quotes, links, bold/italic/strikethrough. Rendered with react-markdown +
// remark-gfm and deliberately NO rehype-raw, so any raw HTML embedded in the
// source prints as literal text rather than executing — no sanitizer needed.
// See docs/design-richtext.md (Security model). Styling comes from
// @tailwindcss/typography (`prose`), themed to the app tokens in globals.css.
export function Markdown({ children, className }: MarkdownProps) {
  return (
    <div className={cn(PROSE_CLASSNAME, className)}>
      <ReactMarkdown remarkPlugins={REMARK_PLUGINS}>{children}</ReactMarkdown>
    </div>
  );
}

// Elements the constrained variant keeps: inline marks, line breaks, and
// paragraphs. The blowout-prone blocks (headings, lists, quotes) are unwrapped
// to their text via `unwrapDisallowed` so a full description can't break a card
// layout, but paragraphs and breaks are preserved so the author's line breaks
// show. This is react-markdown's element allowlist for layout, not a security
// control — the no-rehype-raw render path is already XSS-safe on its own.
const INLINE_ALLOWED = ["p", "a", "em", "strong", "del", "br"];

// Render each paragraph as a block span: a blank-line break becomes a new line
// without inheriting the global <p> sizing/margins (so it keeps the caller's
// text size) — pairing with remark-breaks' <br> for single-newline breaks.
const INLINE_COMPONENTS = {
  p: ({ children }: { children?: ReactNode }) => <span className="block">{children}</span>,
};

// Constrained inline variant for cards and other truncated surfaces. Keeps the
// inline formatting and the author's line breaks; the caller supplies the
// font/colour and a line-clamp.
export function MarkdownInline({ children, className }: MarkdownProps) {
  return (
    <div className={cn("[&_a]:underline", className)}>
      <ReactMarkdown
        remarkPlugins={REMARK_PLUGINS}
        allowedElements={INLINE_ALLOWED}
        unwrapDisallowed
        components={INLINE_COMPONENTS}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
