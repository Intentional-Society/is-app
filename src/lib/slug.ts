// Shared by the server (slug derivation/validation in profiles.ts) and
// the client (live preview in the settings slug form), so both sides
// normalize identically.
export const toSlug = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

// The next permutation of a taken slug: "aria-chen" → "aria-chen-2",
// "aria-chen-2" → "aria-chen-3". Used when a derived slug collides, so
// a display-name twin still gets a readable URL.
export const nextSlug = (slug: string): string => {
  const numbered = slug.match(/^(.*)-([0-9]+)$/);
  return numbered ? `${numbered[1]}-${Number(numbered[2]) + 1}` : `${slug}-2`;
};
