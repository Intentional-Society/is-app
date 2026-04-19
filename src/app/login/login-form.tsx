"use client";

import { useState } from "react";

import { createClient } from "@/lib/supabase/client";

type FormState =
  | { status: "idle" }
  | { status: "submitting" }
  | { status: "sent"; email: string }
  | { status: "error"; message: string };

export function LoginForm() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<FormState>({ status: "idle" });

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setState({ status: "submitting" });

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    });

    if (error) {
      setState({ status: "error", message: error.message });
      return;
    }

    setState({ status: "sent", email });
  };

  if (state.status === "sent") {
    return (
      <p className="max-w-sm text-center text-sm text-gray-300">
        Check <span className="font-semibold">{state.email}</span> for a
        sign-in link.
      </p>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex w-full max-w-sm flex-col gap-3"
    >
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
        disabled={state.status === "submitting"}
        className="rounded border border-gray-600 bg-transparent px-3 py-2 text-sm text-gray-900 focus:border-gray-300 focus:outline-none"
      />
      <button
        type="submit"
        disabled={state.status === "submitting"}
        className="rounded bg-gray-100 px-3 py-2 text-sm font-medium text-gray-900 disabled:opacity-50"
      >
        {state.status === "submitting" ? "Sending…" : "Send sign-in link"}
      </button>
      {state.status === "error" && (
        <p role="alert" className="text-sm text-red-300">
          {state.message}
        </p>
      )}
    </form>
  );
}
