import { hc } from "hono/client";
import type { ApiRoutes } from "@/server/api";

export const apiClient = hc<ApiRoutes>("/");
