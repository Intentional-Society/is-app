"use client";

import dynamic from "next/dynamic";

import type { MarkdownEditorProps } from "./markdown-editor-impl";

export type { MarkdownEditorProps, MarkdownEditorVariant } from "./markdown-editor-impl";

// MDXEditor is a large, Lexical-based, client-only widget. Load it lazily so
// its chunk is fetched only when an author actually mounts a form — never on
// the render-only pages (public program detail, member profile, list cards),
// which ship only react-markdown. ssr:false because Lexical reads `window` at
// module load. See docs/design-richtext.md (Bundle weight).
const MarkdownEditorImpl = dynamic(() => import("./markdown-editor-impl").then((m) => m.MarkdownEditorImpl), {
  ssr: false,
  loading: () => <div className="min-h-32 animate-pulse rounded-lg border border-input bg-input/30" aria-hidden />,
});

export function MarkdownEditor(props: MarkdownEditorProps) {
  return <MarkdownEditorImpl {...props} />;
}
