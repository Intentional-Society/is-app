"use client";

import { useState } from "react";

import { apiClient } from "@/lib/api";
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

export function SignupForm({ initialCode }: { initialCode: string }) {
  const [step, setStep] = useState<Step>({ kind: "enter-code" });
  const [codeInput, setCodeInput] = useState(initialCode);
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");

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
          error:
            REASON_MESSAGES[body.reason] ?? "That invite is no longer valid.",
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
          emailRedirectTo: `${window.location.origin}/auth/callback?invite=${code}`,
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
        message:
          err instanceof Error ? err.message : "Unexpected error while sending.",
        code,
        note,
      });
    }
  };

  if (step.kind === "sent") {
    return (
      <p className="max-w-sm text-center text-sm text-gray-300">
        Check <span className="font-semibold">{step.email}</span> for a
        sign-in link. Open it in this same browser within 15 minutes.
      </p>
    );
  }

  if (step.kind === "code-valid" || step.kind === "submitting" || step.kind === "error") {
    const submitting = step.kind === "submitting";
    return (
      <form
        onSubmit={sendMagicLink}
        className="flex w-full max-w-sm flex-col gap-3"
      >
        <p className="rounded border border-gray-700 bg-gray-900/40 p-3 text-sm text-gray-200">
          <span className="block text-xs uppercase tracking-wide text-gray-400">
            Your invite note
          </span>
          {step.note}
        </p>
        <label htmlFor="displayName" className="text-sm text-gray-300">
          Display name
        </label>
        <input
          id="displayName"
          type="text"
          required
          autoComplete="name"
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
          disabled={submitting}
          className="rounded border border-gray-600 bg-transparent px-3 py-2 text-sm text-gray-900 focus:border-gray-300 focus:outline-none"
        />
        <label htmlFor="email" className="text-sm text-gray-300">
          Email
        </label>
        <input
          id="email"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          disabled={submitting}
          className="rounded border border-gray-600 bg-transparent px-3 py-2 text-sm text-gray-900 focus:border-gray-300 focus:outline-none"
        />
        <button
          type="submit"
          disabled={submitting}
          className="rounded bg-gray-100 px-3 py-2 text-sm font-medium text-gray-900 disabled:opacity-50"
        >
          {submitting ? "Sending…" : "Send sign-in link"}
        </button>
        {step.kind === "error" && (
          <p role="alert" className="text-sm text-red-300">
            {step.message}
          </p>
        )}
      </form>
    );
  }

  const checking = step.kind === "code-checking";
  return (
    <form onSubmit={checkCode} className="flex w-full max-w-sm flex-col gap-3">
      <label htmlFor="code" className="text-sm text-gray-300">
        Invite code
      </label>
      <input
        id="code"
        type="text"
        required
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        value={codeInput}
        onChange={(event) => setCodeInput(event.target.value)}
        disabled={checking}
        className="rounded border border-gray-600 bg-transparent px-3 py-2 font-mono text-sm uppercase text-gray-900 focus:border-gray-300 focus:outline-none"
      />
      <button
        type="submit"
        disabled={checking}
        className="rounded bg-gray-100 px-3 py-2 text-sm font-medium text-gray-900 disabled:opacity-50"
      >
        {checking ? "Checking…" : "Check code"}
      </button>
      {step.kind === "enter-code" && step.error && (
        <p role="alert" className="text-sm text-red-300">
          {step.error}
        </p>
      )}
    </form>
  );
}
