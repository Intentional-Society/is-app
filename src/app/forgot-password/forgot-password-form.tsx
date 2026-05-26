"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  const handleSubmit = async (e: React.SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!email) return;
    setStatus("sending");
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/auth/reset-password`,
      });
      if (error) {
        setErrorMsg(error.message);
        setStatus("error");
      } else {
        setStatus("sent");
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Unexpected error.");
      setStatus("error");
    }
  };

  if (status === "sent") {
    return <p className="text-base text-muted-foreground text-center">Password reset email sent — check your inbox.</p>;
  }

  return (
    <form onSubmit={handleSubmit} className="flex w-full max-w-sm flex-col gap-3">
      <Label htmlFor="reset-email">Email</Label>
      <Input
        id="reset-email"
        type="email"
        required
        autoComplete="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        disabled={status === "sending"}
      />
      <Button type="submit" disabled={status === "sending"}>
        {status === "sending" ? "Sending…" : "Send reset link"}
      </Button>
      {status === "error" && (
        <p role="alert" className="text-base text-destructive">
          {errorMsg}
        </p>
      )}
    </form>
  );
}
