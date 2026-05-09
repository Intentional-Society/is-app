"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { apiClient } from "@/lib/api";
import type { RelationCandidate, RelationCandidatesFeed } from "@/lib/api-types";

import { RELATION_CANDIDATES_QUERY_KEY } from "./query-keys";
import { RatingDialog, type RatingTarget } from "./rating-dialog";
import { SuggestionCard } from "./suggestion-card";

const fetchCandidates = async (): Promise<RelationCandidatesFeed> => {
  const res = await apiClient.api.relations.candidates.$get();
  if (!res.ok) throw new Error(`relations/candidates: ${res.status}`);
  return res.json();
};

const targetFromCandidate = (candidate: RelationCandidate): RatingTarget => {
  // Hint cards reveal the hinter's name in the dialog so the member
  // sees who suggested them. ratedYou cards intentionally omit the
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

export function WebBuilder() {
  const { data, isPending, isError } = useQuery({
    queryKey: RELATION_CANDIDATES_QUERY_KEY,
    queryFn: fetchCandidates,
  });
  const [ratingTarget, setRatingTarget] = useState<RatingTarget | null>(null);

  if (isPending) {
    return <p className="text-base text-muted-foreground">Loading suggestions…</p>;
  }
  if (isError) {
    return <p role="alert" className="text-base text-destructive">Couldn&apos;t load suggestions.</p>;
  }

  const { suggestions, otherMembers } = data;
  const openRating = (candidate: RelationCandidate) => setRatingTarget(targetFromCandidate(candidate));

  return (
    <>
      <div className="flex w-full max-w-3xl flex-col gap-8">
        {suggestions.length > 0 && (
          <section aria-labelledby="suggestions-heading" className="flex flex-col gap-3">
            <h2 id="suggestions-heading" className="text-lg font-semibold">
              Suggestions
            </h2>
            <ul className="flex flex-col gap-2">
              {suggestions.map((candidate) => (
                <li key={candidate.id}>
                  <SuggestionCard candidate={candidate} onClick={openRating} />
                </li>
              ))}
            </ul>
          </section>
        )}

        <section aria-labelledby="other-members-heading" className="flex flex-col gap-3">
          <h2 id="other-members-heading" className="text-lg font-semibold">
            Other members
          </h2>
          {otherMembers.length > 0 ? (
            <ul className="flex flex-col gap-2">
              {otherMembers.map((candidate) => (
                <li key={candidate.id}>
                  <SuggestionCard candidate={candidate} onClick={openRating} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-base text-muted-foreground">
              {suggestions.length === 0
                ? "You're caught up — nothing new to suggest right now."
                : "No more members to surface."}
            </p>
          )}
        </section>
      </div>

      <RatingDialog target={ratingTarget} onClose={() => setRatingTarget(null)} />
    </>
  );
}
