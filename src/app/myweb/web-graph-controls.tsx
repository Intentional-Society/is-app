import { Panel } from "@xyflow/react";

import { RELATION_VALUE_LABELS, RELATION_VALUES, type RelationValue } from "@/lib/relation-value";

import { type RelationValueFilter, SPACING_MAX, SPACING_MIN, SPACING_STEP } from "./query-keys";

// The in-canvas view controls: the hops toggle, the relation-depth filter pills,
// and the spacing slider. Presentational — all state lives in WebGraph, which
// owns the query, the cull, and the spacing; this just renders it and reports
// intent back through the callbacks.
export function WebGraphControls({
  hops,
  onHopsChange,
  valueFilter,
  onToggleValue,
  spacing,
  onSpacingChange,
}: {
  hops: 1 | 2;
  onHopsChange: (hops: 1 | 2) => void;
  valueFilter: RelationValueFilter;
  onToggleValue: (value: RelationValue) => void;
  // A multiplier on the neighbor-gap baseline: <1 denser, >1 airier (see SPACING_*
  // in query-keys and computeNeighborNormalization in web-graph-layout).
  spacing: number;
  onSpacingChange: (multiplier: number) => void;
}) {
  return (
    <Panel
      position="top-right"
      className="flex flex-col gap-2 rounded border border-border bg-background/90 p-2 text-sm"
    >
      <label className="flex cursor-pointer items-center gap-2">
        <input type="checkbox" checked={hops === 2} onChange={(e) => onHopsChange(e.target.checked ? 2 : 1)} />
        Friends-of-friends
      </label>
      {/* Independent depth toggles (filled = shown). Reuses the 1–4 vocabulary
       * from the relating dialog; culling a depth thins the web to the ties
       * that matter. */}
      <fieldset className="m-0 flex flex-col gap-1 border-0 p-0">
        <legend className="p-0 text-xs text-muted-foreground">Relationship depth</legend>
        <div className="flex gap-1">
          {RELATION_VALUES.map((v) => {
            const on = valueFilter.has(v);
            return (
              <button
                key={v}
                type="button"
                aria-pressed={on}
                aria-label={`Depth ${v}: ${RELATION_VALUE_LABELS[v].headline}`}
                title={RELATION_VALUE_LABELS[v].headline}
                onClick={() => onToggleValue(v)}
                className={`flex h-6 w-6 items-center justify-center rounded-full border text-xs font-semibold transition-colors ${
                  on
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-transparent text-muted-foreground hover:border-foreground"
                }`}
              >
                {v}
              </button>
            );
          })}
        </div>
      </fieldset>
      {/* Spacing: a multiplier on the rendered neighbor gap. Left packs neighbors
       * closer, right spreads them apart; density is otherwise held constant, so
       * one setting reads the same on every web. The value persists in WebGraph. */}
      <label className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">Spacing</span>
        <input
          type="range"
          min={SPACING_MIN}
          max={SPACING_MAX}
          step={SPACING_STEP}
          value={spacing}
          onChange={(e) => onSpacingChange(Number(e.target.value))}
          className="w-full cursor-pointer accent-primary"
        />
      </label>
    </Panel>
  );
}
