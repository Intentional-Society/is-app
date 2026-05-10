"use client";

import { useQuery } from "@tanstack/react-query";

import { apiClient } from "@/lib/api";
import type { RelationCandidate, RelationCandidatesFeed } from "@/lib/api-types";

import { RELATION_CANDIDATES_QUERY_KEY } from "./query-keys";
import type { RelatingTarget } from "./relating-dialog";
import { SuggestionCard } from "./suggestion-card";

const fetchCandidates = async (): Promise<RelationCandidatesFeed> => {
  const res = await apiClient.api.relations.candidates.$get();
  if (!res.ok) throw new Error(`relations/candidates: ${res.status}`);
  return res.json();
};

const targetFromCandidate = (candidate: RelationCandidate): RelatingTarget => {
  // Hint cards reveal the hinter's name in the dialog so the member
  // sees who suggested them. addedYou cards intentionally omit the
  // value (soft-hide) — the API never sends it, so there's nothing
  // to omit here either.
  const hintAttribution =
    candidate.reason.type === "hint"
      ? `${candidate.reason.hintedBy?.displayName ?? "Someone"} suggested you know each other`
      : null;
  return {
    id: candidate.id,
    displayName: candidate.displayName,
    hintAttribution,
  };
};

export function WebBuilder({ onOpenRelating }: { onOpenRelating: (target: RelatingTarget) => void }) {
  const { data, isPending, isError } = useQuery({
    queryKey: RELATION_CANDIDATES_QUERY_KEY,
    queryFn: fetchCandidates,
  });

  if (isPending) {
    return <p className="text-base text-muted-foreground">Loading suggestions…</p>;
  }
  if (isError) {
    return (
      <p role="alert" className="text-base text-destructive">
        Couldn&apos;t load suggestions.
      </p>
    );
  }

  const { suggestions, otherMembers } = data;
  // Signal-bearing cards (sources 1–4) come first; the pink corner
  // indicator on those cards is enough to differentiate them from the
  // catch-all directory cards (source 5) without a section break.
  const allCandidates = [...suggestions, ...otherMembers];
  const openRelating = (candidate: RelationCandidate) => onOpenRelating(targetFromCandidate(candidate));

  return (
    <section aria-labelledby="add-people-heading" className="flex w-full max-w-3xl flex-col gap-3">
      <h2 id="add-people-heading" className="text-lg font-semibold">
        Add people to your relational web
      </h2>
      {allCandidates.length > 0 ? (
        <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6">
          {allCandidates.map((candidate) => (
            <li key={candidate.id}>
              <SuggestionCard candidate={candidate} onClick={openRelating} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-base text-muted-foreground">
          You&apos;ve connected with everyone — no one left to add right now.
        </p>
      )}
    </section>
  );
}
