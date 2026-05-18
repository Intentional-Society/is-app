"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
      <p className="text-base text-foreground">
        Check <span className="font-semibold">{email}</span> for a sign-in link.
      </p>
      {resent ? (
        <p className="text-base text-success">Link resent.</p>
      ) : (
        <button
          type="button"
          onClick={handleResend}
          disabled={!canResend}
          className="text-base text-muted-foreground underline disabled:no-underline disabled:opacity-50"
        >
          {sending ? "Resending…" : secondsLeft > 0 ? `Resend in ${secondsLeft}s` : "Resend email"}
        </button>
      )}
    </div>
  );
}

export function SigninForm() {
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
    return <SentView email={state.email} origin={window.location.origin} />;
  }

  return (
    <form onSubmit={handleSubmit} className="flex w-full max-w-sm flex-col gap-3">
      <Label htmlFor="email">Email</Label>
      <Input
        id="email"
        type="email"
        required
        autoComplete="email"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        disabled={state.status === "submitting"}
      />
      <Label htmlFor="password">Password (optional)</Label>
      <Input
        id="password"
        type="password"
        autoComplete="current-password"
        placeholder="Leave blank to use magic link"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        disabled={state.status === "submitting"}
      />
      <Button type="submit" disabled={state.status === "submitting"}>
        {state.status === "submitting"
          ? password.length > 0
            ? "Signing in…"
            : "Sending…"
          : password.length > 0
            ? "Sign in"
            : "Send sign-in link"}
      </Button>
      {state.status === "error" && (
        <p role="alert" className="text-base text-destructive">
          {state.message}
        </p>
      )}
    </form>
  );
}

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
        redirectTo: `${window.location.origin}/auth/callback?type=recovery`,
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
        <p role="alert" className="text-base text-destructive">{errorMsg}</p>
      )}
    </form>
  );
}
