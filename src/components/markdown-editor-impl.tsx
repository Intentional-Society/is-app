"use client";

import {
  BlockTypeSelect,
  BoldItalicUnderlineToggles,
  CreateLink,
  headingsPlugin,
  ListsToggle,
  linkDialogPlugin,
  linkPlugin,
  listsPlugin,
  MDXEditor,
  markdownShortcutPlugin,
  quotePlugin,
  Separator,
  StrikeThroughSupSubToggles,
  type Translation,
  toolbarPlugin,
  UndoRedo,
} from "@mdxeditor/editor";
import { useEffect, useState } from "react";

import "@mdxeditor/editor/style.css";

import { PROSE_CLASSNAME } from "@/lib/markdown";
import { cn } from "@/lib/utils";

export type MarkdownEditorVariant = "full" | "inline";

export type MarkdownEditorProps = {
  value: string;
  onChange: (markdown: string) => void;
  // The editor renders a contenteditable <div>, which a <label htmlFor> can't
  // associate with. ariaLabel becomes the editable's accessible name (via the
  // translation override below), so screen readers and getByLabel both find it.
  ariaLabel: string;
  // "full" = paragraphs, h3–h4, lists, quotes, links, bold/italic/strike.
  // "inline" = bold/italic/strike + links only (for blurb-style fields).
  variant?: MarkdownEditorVariant;
  disabled?: boolean;
  placeholder?: string;
};

// Watches the <html> `dark` class (applied imperatively by lib/theme.ts) so we
// can flip MDXEditor onto its own `dark-theme` palette. An observer keeps it in
// sync with the live theme toggle on /me.
function useIsDark(): boolean {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const html = document.documentElement;
    const update = () => setDark(html.classList.contains("dark"));
    update();
    const observer = new MutationObserver(update);
    observer.observe(html, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);
  return dark;
}

const FULL_TOOLBAR = (
  <>
    <UndoRedo />
    <Separator />
    <BoldItalicUnderlineToggles options={["Bold", "Italic"]} />
    <StrikeThroughSupSubToggles options={["Strikethrough"]} />
    <Separator />
    <ListsToggle options={["bullet", "number"]} />
    <Separator />
    {/* Paragraph / Quote / Heading 3–4 (heading levels gated by headingsPlugin). */}
    <BlockTypeSelect />
    <CreateLink />
  </>
);

const INLINE_TOOLBAR = (
  <>
    <UndoRedo />
    <Separator />
    <BoldItalicUnderlineToggles options={["Bold", "Italic"]} />
    <StrikeThroughSupSubToggles options={["Strikethrough"]} />
    <Separator />
    <CreateLink />
  </>
);

export function MarkdownEditorImpl({
  value,
  onChange,
  ariaLabel,
  variant = "full",
  disabled = false,
  placeholder,
}: MarkdownEditorProps) {
  const isDark = useIsDark();
  const inline = variant === "inline";

  // Map the contenteditable's accessible-name key to the field label; leave
  // every other key at its default (preserving {{interpolation}} handling).
  const translation: Translation = (key, defaultValue, interpolations) => {
    if (key === "contentArea.editableMarkdown") return ariaLabel;
    let out = defaultValue;
    if (interpolations) {
      for (const [k, v] of Object.entries(interpolations)) {
        out = out.replaceAll(`{{${k}}}`, String(v));
      }
    }
    return out;
  };

  const plugins = [
    linkPlugin(),
    linkDialogPlugin(),
    ...(inline ? [] : [headingsPlugin({ allowedHeadingLevels: [3, 4] }), listsPlugin(), quotePlugin()]),
    markdownShortcutPlugin(),
    toolbarPlugin({ toolbarContents: () => (inline ? INLINE_TOOLBAR : FULL_TOOLBAR) }),
  ];

  return (
    <MDXEditor
      // Remount when the variant flips so the plugin set is rebuilt cleanly.
      key={variant}
      markdown={value}
      onChange={(markdown, initialMarkdownNormalize) => {
        // Ignore the import-time normalization pass so merely mounting the
        // editor doesn't mark a pristine form dirty.
        if (initialMarkdownNormalize) return;
        onChange(markdown);
      }}
      readOnly={disabled}
      placeholder={placeholder}
      translation={translation}
      plugins={plugins}
      className={cn(
        "is-mdxeditor rounded-lg border border-input bg-transparent transition-colors",
        disabled && "pointer-events-none opacity-50",
        isDark && "dark-theme",
      )}
      // Reuse the renderer's prose typography so the editor is true WYSIWYG —
      // headings, list markers, and link colour match the rendered output
      // (the app's Tailwind preflight strips the browser defaults MDXEditor
      // otherwise leans on). See docs/design-richtext.md.
      contentEditableClassName={cn(PROSE_CLASSNAME, inline ? "min-h-9" : "min-h-32")}
    />
  );
}
