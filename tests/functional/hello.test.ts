import { describe, it, expect } from "vitest";
import app from "@/server/api";

describe("GET /api/hello", () => {
  it("returns a greeting message", async () => {
    const res = await app.request("/api/hello");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.message).toBe("Hello from Intentional Society API");
  });
});
