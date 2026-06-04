// 1..4 vocabulary lives in design-relations.md. Shared between the
// server-side validator and client UIs that decide what to show next to
// a value, so a future range change is a single-file edit.
export type RelationValue = 1 | 2 | 3 | 4;

export const isRelationValue = (v: unknown): v is RelationValue =>
  typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 4;

export const RELATION_VALUES: readonly RelationValue[] = [1, 2, 3, 4];

// Mirror of the vocabulary in design-relations.md. Shared by every UI
// that lets a member pick a 1..4 value (rating dialog, invite form).
export const RELATION_VALUE_LABELS: Record<RelationValue, { headline: string; detail: string }> = {
  1: {
    headline: "Acquaintance",
    detail: "I'm glad we've met and wish them well, but we haven't drawn particularly close.",
  },
  2: {
    headline: "Friend",
    detail: "A genuine friend whom I enjoy and make time for, like others I'm lucky to have.",
  },
  3: {
    headline: "Close Friend",
    detail: "I really confide in, count on, or collaborate with them more than most of my friends.",
  },
  4: {
    headline: "Kin",
    detail:
      "Among the rare few who feel like chosen family or co-founders — soul-level kinship that may last a lifetime.",
  },
};
