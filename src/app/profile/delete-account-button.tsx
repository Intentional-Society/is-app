"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { apiClient } from "@/lib/api";
import { Button } from "@/components/ui/button";

export function DeleteAccountButton() {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDelete = async () => {
    setDeleting(true);
    setError(null);
    try {
      const res = await apiClient.api.me.$delete();
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        if (body.error === "admins_cannot_self_delete") {
          setError("Admin accounts cannot be self-deleted. Ask another admin to remove your admin flag first.");
        } else {
          setError("Something went wrong. Please try again.");
        }
        setDeleting(false);
        return;
      }
      router.push("/");
      router.refresh();
    } catch {
      setError("Something went wrong. Please try again.");
      setDeleting(false);
    }
  };

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="text-sm text-destructive underline hover:no-underline"
      >
        Delete my account
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded border border-destructive/40 bg-destructive/10 p-4">
      <p className="text-sm text-destructive font-medium">
        This will permanently delete your account, profile, relations, and avatar. This cannot be undone.
      </p>
      <div className="flex gap-3">
        <Button
          type="button"
          onClick={handleDelete}
          disabled={deleting}
          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
        >
          {deleting ? "Deleting…" : "Yes, delete my account"}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => setConfirming(false)}
          disabled={deleting}
        >
          Cancel
        </Button>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
