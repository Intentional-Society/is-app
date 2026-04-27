import type { NextConfig } from "next";
import { withAxiom } from "next-axiom";
import { withSentryConfig } from "@sentry/nextjs";

const isProd = process.env.NODE_ENV === "production";

// 'unsafe-eval' is needed by React Refresh under `next dev`. Production Next 15
// does not need it, so we keep it out of the production policy.
const scriptSrc = isProd
  ? "script-src 'self' 'unsafe-inline'"
  : "script-src 'self' 'unsafe-inline' 'unsafe-eval'";

// Local Supabase (started by `npm run dev`) runs at http://127.0.0.1:54321.
// The browser auth client and AuthProvider token refresh call it directly, so
// it has to be in connect-src for dev — but never in production.
const connectSrc = isProd
  ? "connect-src 'self' https://*.supabase.co"
  : "connect-src 'self' https://*.supabase.co http://127.0.0.1:54321";

const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      scriptSrc,
      "style-src 'self' 'unsafe-inline'",
      // Supabase auth: login/signup forms and the AuthProvider's token refresh
      // call GoTrue directly from the browser. Database queries go through Hono
      // ('self'), so PostgREST is not listed. Realtime is not used.
      // Sentry ingest goes through the /monitoring tunnel and next-axiom proxies
      // client telemetry through /_axiom — both covered by 'self'.
      connectSrc,
      "img-src 'self' data: blob: https:",
      "font-src 'self'",
      "worker-src 'self' blob:",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      "upgrade-insecure-requests",
    ].join("; "),
  },
];

const nextConfig: NextConfig = {
  typedRoutes: true,
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};

export default withSentryConfig(withAxiom(nextConfig), {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  widenClientFileUpload: true,
  tunnelRoute: "/monitoring",
  silent: !process.env.CI,
});
