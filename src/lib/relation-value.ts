// 1..4 vocabulary lives in design-relations.md. Shared between the
// server-side validator and client UIs that decide what to show next to
// a value, so a future range change is a single-file edit.
export type RelationValue = 1 | 2 | 3 | 4;

export const isRelationValue = (v: unknown): v is RelationValue =>
  typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 4;
