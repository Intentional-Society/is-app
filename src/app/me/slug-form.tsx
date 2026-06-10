"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiClient } from "@/lib/api";
import { toSlug } from "@/lib/slug";

type Status = { kind: "idle" } | { kind: "submitting" } | { kind: "success" } | { kind: "error"; message: string };

export function SlugForm({ initialSlug }: { initialSlug: string | null }) {
  const router = useRouter();
  const [value, setValue] = useState(initialSlug ?? "");
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  // Adopt an externally changed slug — the welcome step's backfill, or
  // our own save round-tripping through router.refresh(). An effect
  // (not a key-based remount) so the status line survives the refresh
  // instead of flashing away with the old component instance.
  useEffect(() => {
    setValue(initialSlug ?? "");
  }, [initialSlug]);

  // Live preview of the server-side normalization, so "Aria Chen!"
  // shows as /members/aria-chen before saving.
  const normalized = toSlug(value);
  const unchanged = normalized === (initialSlug ?? "");
  const disabled = status.kind === "submitting";

  const handleSubmit = async (e: React.SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (normalized === "") {
      setStatus({ kind: "error", message: "The URL must contain at least one letter or number." });
      return;
    }
    setStatus({ kind: "submitting" });
    try {
      const res = await apiClient.api.me.$put({ json: { slug: normalized } });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setStatus({ kind: "error", message: body.error ?? "Failed to update your profile URL." });
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
      <Input
        id="profile-slug"
        aria-label="Profile URL"
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        disabled={disabled}
        placeholder="your-name"
        autoComplete="off"
      />
      <p className="text-sm text-muted-foreground">
        {normalized
          ? `Your profile will live at /members/${normalized}`
          : "Pick the address your profile lives at, e.g. /members/your-name"}
      </p>

      <Button type="submit" disabled={disabled || unchanged} className="self-start">
        {disabled ? "Saving…" : "Update URL"}
      </Button>

      {status.kind === "success" && (
        <p role="status" className="text-sm text-success">
          Profile URL updated. Links to the old address no longer work.
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
