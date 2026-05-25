"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { apiClient } from "@/lib/api";

// Two admin-triggered Buttondown sync actions:
//
// - Dry run fires immediately; safe to press any time. Logs a diff
//   without writing. Useful during rollout and as a "what would the
//   cron do right now" check after rollout.
//
// - Write opens a confirm step. Only the confirm click triggers the
//   real run. Design discussion in docs/design-buttondown.md →
//   "Endpoint shape".
//
// The result panel is intentionally minimal — the canonical record is
// in Axiom (filter by message == "buttondown sync"). What's shown
// here is just enough to confirm the call landed.

type RunResult =
  | { status: "ok"; summary: Record<string, unknown> }
  | { status: "skipped"; reason: string };

export function ButtondownSyncButtons() {
  const [pending, setPending] = useState<null | "dry-run" | "write">(null);
  const [result, setResult] = useState<RunResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmingWrite, setConfirmingWrite] = useState(false);

  const runDryRun = async () => {
    setError(null);
    setResult(null);
    setPending("dry-run");
    try {
      const res = await apiClient.api.admin["buttondown-sync"]["dry-run"].$post();
      if (!res.ok) throw new Error(`status ${res.status}`);
      setResult((await res.json()) as RunResult);
    } catch (e) {
      setError(e instanceof Error ? e.message : "request failed");
    } finally {
      setPending(null);
    }
  };

  const runWrite = async () => {
    setError(null);
    setResult(null);
    setPending("write");
    setConfirmingWrite(false);
    try {
      const res = await apiClient.api.admin["buttondown-sync"].write.$post();
      if (!res.ok) throw new Error(`status ${res.status}`);
      setResult((await res.json()) as RunResult);
    } catch (e) {
      setError(e instanceof Error ? e.message : "request failed");
    } finally {
      setPending(null);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="secondary" size="sm" disabled={pending !== null} onClick={runDryRun}>
          {pending === "dry-run" ? "Running…" : "Sync Buttondown (dry run)"}
        </Button>

        {confirmingWrite ? (
          <>
            <Button type="button" variant="destructive" size="sm" disabled={pending !== null} onClick={runWrite}>
              {pending === "write" ? "Running…" : "Yes, write to Buttondown"}
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={pending !== null}
              onClick={() => setConfirmingWrite(false)}
            >
              Cancel
            </Button>
          </>
        ) : (
          <Button
            type="button"
            variant="destructive"
            size="sm"
            disabled={pending !== null}
            onClick={() => {
              setError(null);
              setResult(null);
              setConfirmingWrite(true);
            }}
          >
            Sync Buttondown (write)
          </Button>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        Both runs log a structured diff to Axiom (filter <code>message == "buttondown sync"</code>). Write actually
        applies the diff; dry-run skips every PATCH/POST.
      </p>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          Sync failed: {error}
        </p>
      )}

      {result && (
        <pre className="rounded border border-border bg-muted/50 p-3 text-xs">{JSON.stringify(result, null, 2)}</pre>
      )}
    </div>
  );
}
