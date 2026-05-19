"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";

type Status = { kind: "idle" } | { kind: "submitting" } | { kind: "success" } | { kind: "error"; message: string };

export function ChangePasswordForm() {
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
    const supabase = createClient();
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) {
        setStatus({ kind: "error", message: error.message });
      } else {
        setStatus({ kind: "success" });
        setPassword("");
        setConfirm("");
      }
    } catch {
      // A thrown error (network drop, CORS) bypasses the returned { error };
      // catch it so the button doesn't stick on "Saving…" with no feedback.
      setStatus({ kind: "error", message: "Something went wrong. Please try again." });
    }
  };

  const disabled = status.kind === "submitting";

  return (
    <form onSubmit={handleSubmit} className="flex w-full flex-col gap-3">
      <Label htmlFor="new-password">New password</Label>
      <Input
        id="new-password"
        type="password"
        autoComplete="new-password"
        placeholder="At least 8 characters"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        disabled={disabled}
        required
      />

      <Label htmlFor="confirm-password">Confirm new password</Label>
      <Input
        id="confirm-password"
        type="password"
        autoComplete="new-password"
        placeholder="Repeat password"
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        disabled={disabled}
        required
      />

      <Button type="submit" disabled={disabled} className="mt-1">
        {disabled ? "Saving…" : "Set/update password"}
      </Button>

      {status.kind === "success" && (
        <p role="status" className="text-sm text-success">Password updated.</p>
      )}
      {status.kind === "error" && (
        <p role="alert" className="text-sm text-destructive">{status.message}</p>
      )}
    </form>
  );
}
