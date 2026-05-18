"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";

type Status = { kind: "idle" } | { kind: "submitting" } | { kind: "done" } | { kind: "error"; message: string };

export default function ResetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  const handleSubmit = async (e: React.SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (password.length < 8) {
      setStatus({ kind: "error", message: "Password must be at least 8 characters." });
      return;
    }
    if (password !== confirm) {
      setStatus({ kind: "error", message: "Passwords do not match." });
      return;
    }
    setStatus({ kind: "submitting" });
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.updateUser({ password });
      if (error) {
        setStatus({ kind: "error", message: error.message });
      } else {
        setStatus({ kind: "done" });
        setTimeout(() => router.push("/"), 2000);
      }
    } catch (err) {
      setStatus({ kind: "error", message: err instanceof Error ? err.message : "Unexpected error." });
    }
  };

  const disabled = status.kind === "submitting";

  if (status.kind === "done") {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-8">
        <h1 className="text-2xl font-bold">Password updated</h1>
        <p className="text-muted-foreground">Taking you home…</p>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
      <div className="flex flex-col items-center gap-1">
        <h1 className="text-2xl font-bold">Set a new password</h1>
        <p className="text-base text-muted-foreground">Choose a password for your account.</p>
      </div>

      <form onSubmit={handleSubmit} className="flex w-full max-w-sm flex-col gap-3">
        <Label htmlFor="password">New password</Label>
        <Input
          id="password"
          type="password"
          autoComplete="new-password"
          placeholder="At least 8 characters"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={disabled}
          required
        />

        <Label htmlFor="confirm">Confirm password</Label>
        <Input
          id="confirm"
          type="password"
          autoComplete="new-password"
          placeholder="Repeat password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          disabled={disabled}
          required
        />

        <Button type="submit" disabled={disabled} className="mt-1">
          {disabled ? "Saving…" : "Set password"}
        </Button>

        {status.kind === "error" && (
          <p role="alert" className="text-sm text-destructive">{status.message}</p>
        )}
      </form>
    </main>
  );
}
