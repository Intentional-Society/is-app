import type { InferResponseType } from "hono/client";

import type { apiClient } from "@/lib/api";

// Named shapes for API responses, extracted from the Hono route
// inference. Import these instead of reaching into the RPC client at
// every call site. Types only — safe to import from server or client.
//
// Date fields arrive as strings here because they cross JSON; wrap in
// `new Date(...)` at the use site if you need Date semantics.

export type MemberProfile = InferResponseType<(typeof apiClient.api.members)[":id"]["$get"], 200>["profile"];

export type MemberSummary = InferResponseType<(typeof apiClient.api.members)["$get"], 200>["members"][number];

export type Me = InferResponseType<(typeof apiClient.api.me)["$get"], 200>;

export type ProgramsResponse = InferResponseType<(typeof apiClient.api.programs)["$get"], 200>;

export type Program = ProgramsResponse["programs"][number];

export type ProgramDetail = InferResponseType<
  (typeof apiClient.api.programs)["by-slug"][":slug"]["$get"],
  200
>["program"];

export type ProgramDetailMember = ProgramDetail["members"][number];

export type AdminProgram = InferResponseType<
  (typeof apiClient.api.admin.programs)["$get"],
  200
>["programs"][number];

export type AdminProgramDetail = InferResponseType<
  (typeof apiClient.api.admin.programs)[":id"]["$get"],
  200
>["program"];

export type AdminProgramParticipant = AdminProgramDetail["participants"][number];

export type RelationCandidatesFeed = InferResponseType<(typeof apiClient.api.relations.candidates)["$get"], 200>;

export type RelationCandidate = RelationCandidatesFeed["suggestions"][number];

export type RelationSubgraph = InferResponseType<(typeof apiClient.api.relations.subgraph)["$get"], 200>;
