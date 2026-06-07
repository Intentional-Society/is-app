// Header-gated request timing for ad-hoc SSR latency probing on
// preview deploys (and prod in a pinch). Add `x-debug-timing: 1` to a
// request and any `timed(request, label, fn)` block on its path logs
// `[timing] label=Nms` to stdout, which lands in Vercel function logs.
//
// Default behavior is unchanged: when the header is absent, `timed`
// returns the inner promise without measuring — one header.get + a
// boolean check. The helper is meant to stay in the codebase so we
// don't have to re-instrument every time something feels slow.

const enabled = (request: { headers: Headers }): boolean => request.headers.get("x-debug-timing") === "1";

export const timed = async <T>(request: { headers: Headers }, label: string, fn: () => Promise<T>): Promise<T> => {
  if (!enabled(request)) return fn();
  const start = performance.now();
  try {
    return await fn();
  } finally {
    // Intentional console.log, not log.<level>: this is an ad-hoc latency
    // print read inline in the function log, not Axiom telemetry to query.
    // The biome noConsole allowlist covers this file — see docs/doc-axiom.md.
    console.log(`[timing] ${label}=${(performance.now() - start).toFixed(1)}ms`);
  }
};
