import { defaultFilter } from "cmdk";

import type { MemberSummary } from "@/lib/api-types";

// Single source of truth for member search scoring, shared by the cmdk-based
// MemberTypeahead and the Member Directory's plain list filter so both surfaces
// match the same fields with the same behavior.

// Floor applied to cmdk's fuzzy score. Below it, an item is treated as no
// match. Tune here and both surfaces move together.
export const MEMBER_SEARCH_THRESHOLD = 0.8;

// Split a name into its word tokens, dropping punctuation. "Bob (Benya) Smith"
// yields ["Bob", "Benya", "Smith"], so a query for the bare nickname scores
// against a whole token at word strength instead of as a mid-string match the
// threshold rejects — the "(" before a parenthetical nickname otherwise costs
// it the word-start bonus a space-led surname gets (#409).
const nameTokens = (name: string | null): string[] => (name ?? "").split(/[^\p{L}\p{N}]+/u).filter(Boolean);

// The name's own word tokens, plus location + interest keywords, act as search
// aliases — matchable, but ranked below the display name (which is the item
// value). Name tokens make any name word (nickname, surname) matchable
// regardless of punctuation or position.
export const memberKeywords = (m: MemberSummary): string[] =>
  [...nameTokens(m.displayName), m.location ?? "", ...(m.keywords ?? [])].filter(Boolean);

// cmdk's CommandFilter shape: score value/search/keywords and gate at the
// threshold. Pass straight to <Command filter={...}>. defaultFilter is
// commandScore(value, search, keywords), so keywords fold into the score.
export const memberSearchFilter = (value: string, search: string, keywords?: string[]): number => {
  const score = defaultFilter(value, search, keywords);
  return score >= MEMBER_SEARCH_THRESHOLD ? score : 0;
};

// Score a whole member against a query, for non-cmdk callers like the
// directory list. Returns 0 when the match doesn't clear the threshold.
export const scoreMember = (m: MemberSummary, query: string): number =>
  memberSearchFilter(m.displayName ?? "", query, memberKeywords(m));
