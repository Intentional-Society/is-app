import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AppWordmark } from "@/components/app-wordmark";
import { getServerUser } from "@/lib/supabase/server-user";

import { SigninForm } from "./signin-form";

// Public page — opt back in to indexing (root layout is noindex by default).
export const metadata: Metadata = { robots: { index: true, follow: true } };

const ERROR_MESSAGES: Record<string, string> = {
  missing_code: "That sign-in link was incomplete. Please request a new one.",
  exchange_failed:
    "That sign-in link couldn't be verified. It must be opened in the same browser where you requested it, and before it expires. Please request a new one.",
  profile_error: "We signed you in but couldn't finish setting up your profile. Please try again.",
  invite_invalid:
    "That invite code was already used, revoked, or expired by the time you clicked the link. Ask the member who invited you for a new one.",
};

type SigninPageProps = {
  searchParams: Promise<{ error?: string }>;
};

export default async function SigninPage({ searchParams }: SigninPageProps) {
  const user = await getServerUser();
  if (user) {
    redirect("/");
  }

  const { error } = await searchParams;
  const errorMessage = error ? ERROR_MESSAGES[error] : undefined;

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
      <AppWordmark asLink />
      <p className="max-w-sm text-center text-base text-muted-foreground">
        Receive a sign-in link by email, or sign in with your password if you have set one.
      </p>
      {process.env.NODE_ENV === "development" && (
        <p className="max-w-sm rounded border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-400">
          <strong>Local dev:</strong> this database is separate from production. Use a seeded email (e.g.{" "}
          <code>aria.chen@example.com</code>) or run <code>npm run seed:dev</code> first. Sign-in links arrive at{" "}
          <a href="http://localhost:54324" target="_blank" rel="noopener noreferrer" className="underline">
            Inbucket
          </a>
          .
        </p>
      )}
      {errorMessage && (
        <p
          role="alert"
          className="max-w-sm rounded border border-destructive/40 bg-destructive/10 p-3 text-base text-destructive"
        >
          {errorMessage}
        </p>
      )}
      <SigninForm />
      <p className="text-base text-muted-foreground">
        <Link href="/forgot-password" className="underline text-muted-foreground hover:text-foreground">
          Forgot your password?
        </Link>
      </p>
      <p className="text-base text-muted-foreground">
        Have an invite code?{" "}
        <Link href="/signup" className="underline text-muted-foreground hover:text-foreground">
          Sign up
        </Link>
      </p>
    </main>
  );
}
