// 1..4 vocabulary lives in design-relations.md. Shared between the
// server-side validator and client UIs that decide what to show next to
// a value, so a future range change is a single-file edit.
export type RelationValue = 1 | 2 | 3 | 4;

export const isRelationValue = (v: unknown): v is RelationValue =>
  typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 4;

export const RELATION_VALUES: readonly RelationValue[] = [1, 2, 3, 4];

// Mirror of the vocabulary in design-relations.md. Shared by every UI
// that lets a member pick a 1..4 value (relating dialog, invite form).
export const RELATION_VALUE_LABELS: Record<RelationValue, { headline: string; detail: string }> = {
  1: {
    headline: "Acquaintance",
    detail: "I'm glad we've met and wish them well.",
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

// The "No Relationship" affordance shown above 1..4 when a confirmed
// relationship already exists — the escape hatch for a relation made by
// mistake. It deletes the relations row rather than storing a `0`:
// absence of a relationship is absence of a row (see design-relations.md).
export const RELATION_REMOVE_LABEL = {
  headline: "No Relationship",
  detail: "Remove this relationship from my web.",
};

// Reassurance shown wherever a member picks a 1..4 value — the relating
// dialog and the invite form. One definition so the two never drift.
export const RELATION_VALUE_VISIBILITY_NOTE =
  "Yes, these become visible to them and others. It's okay to pick a different relationship depth estimate than they do for you! Everyone will have their own slightly unique interpretation.";
