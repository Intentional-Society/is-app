"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { apiClient } from "@/lib/api";

type Status = { kind: "idle" } | { kind: "confirming" } | { kind: "removing" } | { kind: "error"; message: string };

export function RemovePasswordForm({ onRemoved }: { onRemoved?: () => void }) {
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  const handleRemove = async () => {
    setStatus({ kind: "removing" });
    try {
      const res = await apiClient.api.me.password.$delete({});
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setStatus({ kind: "error", message: body.error ?? "Failed to remove password." });
        return;
      }
      onRemoved?.();
    } catch {
      setStatus({ kind: "error", message: "Unexpected error. Please try again." });
    }
  };

  if (status.kind === "idle") {
    return (
      <Button variant="ghost" onClick={() => setStatus({ kind: "confirming" })} className="self-start">
        Remove password
      </Button>
    );
  }

  if (status.kind === "confirming") {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-sm text-muted-foreground">
          You'll only be able to sign in via email link. You can set a new password at any time.
        </p>
        <div className="flex gap-2">
          <Button variant="destructive" onClick={handleRemove} className="self-start">
            Yes, remove password
          </Button>
          <Button variant="ghost" onClick={() => setStatus({ kind: "idle" })} className="self-start">
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  if (status.kind === "removing") {
    return <p className="text-sm text-muted-foreground">Removing password…</p>;
  }

  return (
    <p role="alert" className="text-sm text-destructive">
      {status.message}
    </p>
  );
}
