"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiClient } from "@/lib/api";
import { INVITE_CODE_LENGTH } from "@/lib/invite-limits";
import { createClient } from "@/lib/supabase/client";

type Step =
  | { kind: "enter-code"; error?: string }
  | { kind: "code-checking" }
  | { kind: "code-valid"; code: string; note: string }
  | { kind: "submitting"; code: string; note: string }
  | { kind: "sent"; email: string }
  | { kind: "error"; message: string; code: string; note: string };

const REASON_MESSAGES: Record<string, string> = {
  not_found: "That code doesn't match any invite we have.",
  revoked: "That invite has been revoked by the member who created it.",
  expired: "That invite has expired.",
  redeemed: "That invite has already been used.",
};

export function SignupForm({ initialCode, intro }: { initialCode: string; intro: string }) {
  const [step, setStep] = useState<Step>({ kind: "enter-code" });
  const [codeInput, setCodeInput] = useState(initialCode);
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");

  // Whether the code arrived prefilled from the invite link.
  const prefilled = initialCode.trim().length > 0;

  const checkCode = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalized = codeInput.trim().toUpperCase();
    if (normalized.length === 0) return;
    setStep({ kind: "code-checking" });

    try {
      const res = await apiClient.api.invites[":code"].check.$get({
        param: { code: normalized },
      });
      if (!res.ok) {
        setStep({
          kind: "enter-code",
          error: "Something went wrong checking that code. Please try again.",
        });
        return;
      }
      const body = await res.json();
      if (body.valid) {
        setStep({ kind: "code-valid", code: normalized, note: body.note });
      } else {
        setStep({
          kind: "enter-code",
          error: REASON_MESSAGES[body.reason] ?? "That invite is no longer valid.",
        });
      }
    } catch {
      setStep({
        kind: "enter-code",
        error: "Network error. Please try again.",
      });
    }
  };

  const sendMagicLink = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (step.kind !== "code-valid") return;
    const { code, note } = step;
    setStep({ kind: "submitting", code, note });

    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback?type=email&invite=${code}`,
          data: { displayName: displayName.trim() || null },
        },
      });
      if (error) {
        setStep({ kind: "error", message: error.message, code, note });
        return;
      }
      setStep({ kind: "sent", email });
    } catch (err) {
      setStep({
        kind: "error",
        message: err instanceof Error ? err.message : "Unexpected error while sending.",
        code,
        note,
      });
    }
  };

  let content: React.ReactNode;
  if (step.kind === "sent") {
    content = (
      <p className="max-w-sm text-center text-base text-foreground">
        Check <span className="font-semibold">{step.email}</span> for a sign-in link. It expires in 15 minutes.
      </p>
    );
  } else if (step.kind === "code-valid" || step.kind === "submitting" || step.kind === "error") {
    const submitting = step.kind === "submitting";
    content = (
      <form onSubmit={sendMagicLink} className="flex w-full flex-col gap-3">
        <p className="rounded border border-border bg-muted p-3 text-base text-foreground">
          <span className="block text-sm uppercase tracking-wide text-muted-foreground">This invitation is for…</span>
          {step.note}
        </p>
        <Label htmlFor="displayName">Display name</Label>
        <Input
          id="displayName"
          type="text"
          required
          autoComplete="name"
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
          disabled={submitting}
        />
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          disabled={submitting}
        />
        <Button type="submit" disabled={submitting}>
          {submitting ? "Sending…" : "Verify your email"}
        </Button>
        {step.kind === "error" && (
          <p role="alert" className="text-base text-destructive">
            {step.message}
          </p>
        )}
      </form>
    );
  } else {
    const checking = step.kind === "code-checking";
    const ready = codeInput.trim().length === INVITE_CODE_LENGTH;
    const codeError = step.kind === "enter-code" ? step.error : undefined;
    // Hide the code field when it arrived prefilled from the invite link and
    // is a complete code that hasn't errored — the user doesn't need to see
    // or touch it (#419). A malformed or rejected prefilled code reveals the
    // field so they can fix it; an empty (no-code) arrival shows it as normal.
    const showCodeField = !prefilled || !ready || Boolean(codeError);
    content = (
      <form onSubmit={checkCode} className="flex w-full flex-col gap-3">
        {showCodeField && (
          <>
            <Label htmlFor="code">Invite code</Label>
            <Input
              id="code"
              type="text"
              required
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              value={codeInput}
              onChange={(event) => setCodeInput(event.target.value)}
              disabled={checking}
              className="font-mono uppercase"
            />
          </>
        )}
        <Button type="submit" disabled={checking || !ready}>
          {checking ? "Checking…" : ready ? "Sign up!" : "Enter invite code…"}
        </Button>
        {codeError && (
          <p role="alert" className="text-base text-destructive">
            {codeError}
          </p>
        )}
      </form>
    );
  }

  return (
    <div className="flex w-full max-w-sm flex-col items-center gap-6">
      {step.kind !== "sent" && <p className="text-center text-base text-muted-foreground">{intro}</p>}
      {content}
    </div>
  );
}
