"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { apiClient } from "@/lib/api";

export function DeactivateAccountForm() {
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
      router.push("/signin");
    } catch {
      setError("Unexpected error. Please try again.");
      setBusy(false);
    }
  };

  if (!confirming) {
    return (
      <Button variant="destructive" onClick={() => setConfirming(true)}>
        Deactivate account
      </Button>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        This will hide your profile from all other members. You can ask an admin to reactivate your account at any
        time.
      </p>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex gap-3">
        <Button variant="destructive" disabled={busy} onClick={handleDeactivate}>
          {busy ? "Deactivating…" : "Yes, deactivate my account"}
        </Button>
        <Button variant="outline" disabled={busy} onClick={() => setConfirming(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
