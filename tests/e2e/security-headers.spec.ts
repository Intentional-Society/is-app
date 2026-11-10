import { expect, test } from "./helpers/fixtures";

// The response headers next.config.ts attaches to every route
// (docs/strategy-security.md → HTTP headers). They exist only in the
// served response, so nothing short of a request against a running
// build shows that the config still applies them — to a page and to an
// API route alike.

for (const path of ["/signin", "/api/version"]) {
  test(`${path} is served with the security headers`, async ({ request, baseURL }) => {
    const res = await request.get(path);
    expect(res.status()).toBe(200);
    const headers = res.headers();

    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["permissions-policy"]).toBe("camera=(), microphone=(), geolocation=()");
    expect(headers["strict-transport-security"]).toContain("max-age=63072000");

    const csp = headers["content-security-policy"] ?? "";
    for (const directive of [
      "default-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ]) {
      expect(csp).toContain(directive);
    }
    // 'unsafe-eval' is in the policy only for `next dev`, where React
    // Refresh needs it. A deployed build must not carry it.
    if (baseURL?.startsWith("https://")) {
      expect(csp).not.toContain("'unsafe-eval'");
    }
  });
}
