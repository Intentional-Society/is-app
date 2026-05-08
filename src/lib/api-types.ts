import type { InferResponseType } from "hono/client";

import { apiClient } from "@/lib/api";

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
