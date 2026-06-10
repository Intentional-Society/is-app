"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { apiClient } from "@/lib/api";

type Status = { kind: "idle" } | { kind: "submitting" } | { kind: "success" } | { kind: "error"; message: string };

export function EmergencyContactForm({ initial }: { initial: string }) {
  const router = useRouter();
  const [value, setValue] = useState(initial);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const disabled = status.kind === "submitting";

  // Adopt the server's value after our own save round-trips through
  // router.refresh() — an effect (not a key-based remount) so the
  // status line survives the refresh instead of flashing away.
  useEffect(() => {
    setValue(initial);
  }, [initial]);

  const handleSubmit = async (e: React.SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();
    setStatus({ kind: "submitting" });
    try {
      const res = await apiClient.api.me.$put({ json: { emergencyContact: value.trim() || null } });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setStatus({ kind: "error", message: body.error ?? "Failed to save your emergency contact." });
        return;
      }
      setStatus({ kind: "success" });
      router.refresh();
    } catch (err) {
      setStatus({ kind: "error", message: err instanceof Error ? err.message : "Unexpected error while saving." });
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex w-full flex-col gap-3">
      <Textarea
        id="emergencyContact"
        aria-label="Emergency contact"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        disabled={disabled}
        rows={3}
        placeholder="Name, relationship, phone number"
      />

      <Button type="submit" disabled={disabled} className="self-start">
        {disabled ? "Saving…" : "Save emergency contact"}
      </Button>

      {status.kind === "success" && (
        <p role="status" className="text-sm text-success">
          Emergency contact saved.
        </p>
      )}
      {status.kind === "error" && (
        <p role="alert" className="text-sm text-destructive">
          {status.message}
        </p>
      )}
    </form>
  );
}
