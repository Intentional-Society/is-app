// Shared by the server (slug derivation/validation in profiles.ts) and
// the client (live preview in the settings slug form), so both sides
// normalize identically.
export const toSlug = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
