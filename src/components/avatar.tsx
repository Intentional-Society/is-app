import Image from "next/image";

// 1–2 letter initials from the first letters of up to two whitespace-
// separated tokens. `filter(Boolean)` guards against double-spaces;
// the trailing `|| "?"` keeps an empty/whitespace name from rendering
// nothing where a label is expected.
export const initials = (name: string | null): string =>
  (name ?? "?")
    .split(" ")
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase() || "?";

// One `className` styles both states — when `url` is present the image
// fills the container (the wrapper is `relative` so next/image `fill`
// has a positioned ancestor); when absent, the initials sit centered
// using the caller's background/font classes. Avatar objects come from
// our own Supabase Storage host, so next/image optimisation applies.
// `sizes` lets a caller hint the rendered size; the 96px default suits
// the small avatars (graph nodes, typeahead) — the members grid and
// profile page pass larger values. `priority` opts an above-the-fold
// single avatar (profile page, uploader preview) out of next/image's
// default lazy-loading. Default `alt=""` because every call site
// renders the displayName as visible sibling text, so the avatar is
// decorative for screen readers.
export function Avatar({
  name,
  url,
  alt = "",
  sizes = "96px",
  priority = false,
  className,
}: {
  name: string | null;
  url: string | null | undefined;
  alt?: string;
  sizes?: string;
  priority?: boolean;
  className?: string;
}) {
  return (
    <div className={`relative ${className ?? ""}`}>
      {url ? (
        <Image src={url} alt={alt} fill sizes={sizes} priority={priority} className="object-cover" />
      ) : (
        <span>{initials(name)}</span>
      )}
    </div>
  );
}
