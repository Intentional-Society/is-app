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

// One className styles both states — when `url` is present the image
// fills the container and the background/font classes hide behind it;
// when absent, the initials sit centered using those same classes. This
// keeps the call site to a single style declaration regardless of which
// branch renders. Default `alt=""` because every call site so far
// renders the displayName as visible sibling text (so the avatar is
// decorative for screen readers).
export function Avatar({
  name,
  url,
  alt = "",
  className,
}: {
  name: string | null;
  url: string | null | undefined;
  alt?: string;
  className?: string;
}) {
  return (
    <div className={className}>
      {url ? (
        // biome-ignore lint/performance/noImgElement: avatarUrl is user-supplied and can come from any host
        <img src={url} alt={alt} className="h-full w-full object-cover" />
      ) : (
        <span>{initials(name)}</span>
      )}
    </div>
  );
}
