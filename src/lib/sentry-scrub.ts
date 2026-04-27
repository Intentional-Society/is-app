import type { ErrorEvent } from "@sentry/nextjs";

const AUTH_ROUTE_FRAGMENTS = ["/auth/", "/login", "/signup"] as const;

const isAuthRoute = (url: string): boolean =>
  AUTH_ROUTE_FRAGMENTS.some((fragment) => url.includes(fragment));

// Auth callback URLs can carry tokens (?code=..., ?access_token=...). Drop the
// query string on auth routes so the event still ships with its path intact.
export const scrubClientEvent = (event: ErrorEvent): ErrorEvent => {
  const url = event.request?.url;
  if (url && isAuthRoute(url) && event.request) {
    const [path] = url.split("?");
    event.request.url = path;
    delete event.request.query_string;
  }
  return event;
};

// Session cookies and bearer tokens never belong in error reports.
export const scrubServerEvent = (event: ErrorEvent): ErrorEvent => {
  if (!event.request) return event;
  delete event.request.cookies;
  if (event.request.headers) {
    delete event.request.headers["authorization"];
    delete event.request.headers["cookie"];
  }
  return event;
};
