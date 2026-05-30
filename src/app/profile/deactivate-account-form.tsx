"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { apiClient } from "@/lib/api";

type Props = { isDeactivated: boolean };

export function DeactivateAccountForm({ isDeactivated }: Props) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDeactivate = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await apiClient.api.me.deactivate.$post({});
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? "Failed to deactivate account.");
        setBusy(false);
        return;
      }
      router.refresh();
    } catch {
      setError("Unexpected error. Please try again.");
      setBusy(false);
    }
  };

  const handleReactivate = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await apiClient.api.me.reactivate.$post({});
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? "Failed to reactivate account.");
        setBusy(false);
        return;
      }
      router.refresh();
    } catch {
      setError("Unexpected error. Please try again.");
      setBusy(false);
    }
  };

  if (isDeactivated) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">Your account is currently deactivated.</p>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button variant="secondary" disabled={busy} onClick={handleReactivate}>
          {busy ? "Reactivating…" : "Reactivate account"}
        </Button>
      </div>
    );
  }

  if (!confirming) {
    return (
      <Button variant="destructive" onClick={() => setConfirming(true)}>
        Deactivate account
      </Button>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">Are you sure? You can reactivate your account here at any time.</p>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex gap-3">
        <Button variant="destructive" disabled={busy} onClick={handleDeactivate}>
          {busy ? "Deactivating…" : "Yes, deactivate my account"}
        </Button>
        <Button variant="ghost" disabled={busy} onClick={() => setConfirming(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
