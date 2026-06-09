import { withSentryConfig } from "@sentry/nextjs";
import type { NextConfig } from "next";
import { withAxiom } from "next-axiom";

const isProd = process.env.NODE_ENV === "production";

// 'unsafe-eval' is needed by React Refresh under `next dev`. Production Next 15
// does not need it, so we keep it out of the production policy.
const scriptSrc = isProd ? "script-src 'self' 'unsafe-inline'" : "script-src 'self' 'unsafe-inline' 'unsafe-eval'";

// Local Supabase (started by `npm run dev`) runs at http://127.0.0.1:54321 by
// default. Derive the origin from NEXT_PUBLIC_SUPABASE_URL so worktree "lanes"
// on offset ports (e.g. :54521) work without editing this file — see
// docs/strategy-worktree-lanes.md.
const localSupabaseUrl = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321");

// The browser auth client and AuthProvider token refresh call Supabase
// directly, so it has to be in connect-src for dev — but never in production.
const connectSrc = isProd
  ? "connect-src 'self' https://*.supabase.co"
  : `connect-src 'self' https://*.supabase.co ${localSupabaseUrl.origin}`;

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
      // Supabase auth: signin/signup forms and the AuthProvider's token refresh
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

// Avatar objects are served from Supabase Storage (signed URLs) and
// rendered through next/image, so the optimizer must be allowed to
// fetch from the Supabase host. Local dev points at the Supabase
// container (host/port from NEXT_PUBLIC_SUPABASE_URL) — mirror the isProd
// CSP branching.
const remotePatterns: NonNullable<NextConfig["images"]>["remotePatterns"] = [
  { protocol: "https", hostname: "*.supabase.co", pathname: "/storage/v1/object/**" },
];
if (!isProd) {
  remotePatterns.push({
    protocol: "http",
    hostname: localSupabaseUrl.hostname,
    port: localSupabaseUrl.port,
    pathname: "/storage/v1/object/**",
  });
}

const nextConfig: NextConfig = {
  typedRoutes: true,
  images: {
    remotePatterns,
    // The local Supabase Storage container lives on 127.0.0.1, which
    // Next 16's optimizer blocks as an SSRF guard. Allow it in dev
    // only — production avatars come from the public *.supabase.co host.
    dangerouslyAllowLocalIP: !isProd,
  },
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
  // /profile and /profile/edit merged into /me (#376). Temporary (307)
  // rather than permanent so the URLs stay reusable later.
  async redirects() {
    return [
      { source: "/profile", destination: "/me", permanent: false },
      { source: "/profile/edit", destination: "/me", permanent: false },
    ];
  },
};

export default withSentryConfig(withAxiom(nextConfig), {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  widenClientFileUpload: true,
  tunnelRoute: "/monitoring",
  silent: !process.env.CI,
  sourcemaps: { disable: process.env.VERCEL_ENV !== "production" },
});
