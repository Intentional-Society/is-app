"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { createClient } from "@/lib/supabase/client";

const RESEND_COOLDOWN_SECONDS = 60;

type FormState =
  | { status: "idle" }
  | { status: "submitting" }
  | { status: "sent"; email: string }
  | { status: "resending" }
  | { status: "error"; message: string };

function SentView({ email, origin }: { email: string; origin: string }) {
  const [secondsLeft, setSecondsLeft] = useState(RESEND_COOLDOWN_SECONDS);
  const [sending, setSending] = useState(false);
  const [resent, setResent] = useState(false);

  useEffect(() => {
    if (secondsLeft <= 0) return;
    const id = setTimeout(() => setSecondsLeft((s) => s - 1), 1000);
    return () => clearTimeout(id);
  }, [secondsLeft]);

  const handleResend = async () => {
    setSending(true);
    const supabase = createClient();
    await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${origin}/auth/callback`,
        shouldCreateUser: false,
      },
    });
    setSending(false);
    setResent(true);
    setSecondsLeft(RESEND_COOLDOWN_SECONDS);
  };

  const canResend = secondsLeft <= 0 && !sending && !resent;

  return (
    <div className="flex max-w-sm flex-col items-center gap-4 text-center">
      <p className="text-sm text-foreground">
        Check <span className="font-semibold">{email}</span> for a sign-in link.
      </p>
      {resent ? (
        <p className="text-sm text-success">Link resent.</p>
      ) : (
        <button
          onClick={handleResend}
          disabled={!canResend}
          className="text-sm text-muted-foreground underline disabled:no-underline disabled:opacity-50"
        >
          {sending
            ? "Resending…"
            : secondsLeft > 0
              ? `Resend in ${secondsLeft}s`
              : "Resend email"}
        </button>
      )}
    </div>
  );
}

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [state, setState] = useState<FormState>({ status: "idle" });

  const handleSubmit = async (event: React.SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    setState({ status: "submitting" });

    const supabase = createClient();

    if (password.length > 0) {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (error) {
        // No fallback to magic link — a failed password means the
        // member mistyped it; falling through silently would be
        // confusing. They can clear the field and resubmit.
        setState({ status: "error", message: error.message });
        return;
      }
      router.push("/");
      router.refresh();
      return;
    }

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
        // Block auto-creation of users via this form. Keeps auth.users
        // from accumulating rows when a bot (or a typo) submits unknown
        // emails, and closes the loophole where a pre-existing row with
        // empty user_metadata silently swallows the displayName that
        // /signup tries to set via options.data on first sign-in.
        //
        // Supabase's /otp endpoint returns 422 (otp_disabled) for
        // unknown emails — we surface that error directly. It makes
        // the endpoint an account-enumeration oracle at the HTTP
        // layer, but hiding the error in the UI wouldn't change that
        // (anyone can read the Network tab), so there's no point
        // pretending otherwise.
        shouldCreateUser: false,
      },
    });

    if (error) {
      // GoTrue's "Signups not allowed for otp" is literal-true but
      // reads as gibberish. Rewrite it to something a human can act on.
      const message =
        error.code === "otp_disabled"
          ? "No account found for that email. If you have an invite code, head to /signup."
          : error.message;
      setState({ status: "error", message });
      return;
    }

    setState({ status: "sent", email });
  };

  if (state.status === "sent") {
    return (
      <SentView email={state.email} origin={window.location.origin} />
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex w-full max-w-sm flex-col gap-3"
    >
      <label htmlFor="email" className="text-sm text-foreground">
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
        className="rounded border border-input bg-transparent px-3 py-2 text-sm text-foreground focus:border-ring focus:outline-none"
      />
      <label htmlFor="password" className="text-sm text-foreground">
        Password (optional)
      </label>
      <input
        id="password"
        type="password"
        autoComplete="current-password"
        placeholder="Leave blank to use magic link"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        disabled={state.status === "submitting"}
        className="rounded border border-input bg-transparent px-3 py-2 text-sm text-foreground focus:border-ring focus:outline-none"
      />
      <button
        type="submit"
        disabled={state.status === "submitting"}
        className="rounded bg-secondary px-3 py-2 text-sm font-medium text-secondary-foreground disabled:opacity-50"
      >
        {state.status === "submitting"
          ? password.length > 0
            ? "Signing in…"
            : "Sending…"
          : password.length > 0
            ? "Sign in"
            : "Send sign-in link"}
      </button>
      {state.status === "error" && (
        <p role="alert" className="text-sm text-destructive">
          {state.message}
        </p>
      )}
    </form>
  );
}
