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
  1: { headline: "Acquaintance / Supporter", detail: "I have spent some time with them and feel supportive." },
  2: { headline: "Friend / Collaborator", detail: "I trust them in most ways and we can work well together." },
  3: { headline: "Companion / Comrade", detail: "I feel deep resonance and shared purpose with them." },
  4: { headline: "Kindred / Co-Creator", detail: "A kindred spirit; I hope to partner with them for decades." },
};
