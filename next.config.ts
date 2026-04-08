import type { NextConfig } from "next";
import { withAxiom } from "next-axiom";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  typedRoutes: true,
};

export default withSentryConfig(withAxiom(nextConfig), {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  widenClientFileUpload: true,
  tunnelRoute: "/monitoring",
  silent: !process.env.CI,
});
