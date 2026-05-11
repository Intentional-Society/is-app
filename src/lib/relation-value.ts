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
  1: { headline: "Met in a group", detail: "We've met in group settings and know of each other." },
  2: { headline: "Talked 1-on-1", detail: "We've spent some time talking 1-on-1 enjoyably." },
  3: { headline: "Friend", detail: "Friend." },
  4: { headline: "Deep trust", detail: "Deep trust and knowing." },
};
