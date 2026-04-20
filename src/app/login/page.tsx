import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

import { LoginForm } from "./login-form";

const ERROR_MESSAGES: Record<string, string> = {
  missing_code: "That sign-in link was incomplete. Please request a new one.",
  exchange_failed:
    "That sign-in link couldn't be verified. It must be opened in the same browser where you requested it, and before it expires. Please request a new one.",
  profile_error:
    "We signed you in but couldn't finish setting up your profile. Please try again.",
  invite_invalid:
    "That invite code was already used, revoked, or expired by the time you clicked the link. Ask the member who invited you for a new one.",
};

type LoginPageProps = {
  searchParams: Promise<{ error?: string }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) {
    redirect("/");
  }

  const { error } = await searchParams;
  const errorMessage = error ? ERROR_MESSAGES[error] : undefined;

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
      <h1 className="text-4xl font-bold">Intentional Society</h1>
      <p className="max-w-sm text-center text-sm text-gray-400">
        Sign in with your password, or leave it blank to receive a magic
        link by email.
      </p>
      {errorMessage && (
        <p
          role="alert"
          className="max-w-sm rounded border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300"
        >
          {errorMessage}
        </p>
      )}
      <LoginForm />
    </main>
  );
}
