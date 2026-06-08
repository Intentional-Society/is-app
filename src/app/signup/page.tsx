import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AppWordmark } from "@/components/app-wordmark";
import { getServerUser } from "@/lib/supabase/server-user";

import { SignupForm } from "./signup-form";

// Public page — opt back in to indexing (root layout is noindex by default).
export const metadata: Metadata = { robots: { index: true, follow: true } };

type SignupPageProps = {
  searchParams: Promise<{ code?: string }>;
};

export default async function SignupPage({ searchParams }: SignupPageProps) {
  const user = await getServerUser();
  if (user) {
    // Already signed in — nothing to do here.
    redirect("/");
  }

  const { code } = await searchParams;

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
      <AppWordmark asLink />
      <SignupForm
        initialCode={code ?? ""}
        intro="You've been invited to join! If your link has prefilled the code below, just hit the 'Sign up!' button to get going. Otherwise, paste in the invite code."
      />
      <p className="text-base text-muted-foreground">
        Already a member?{" "}
        <Link href="/signin" className="underline text-muted-foreground hover:text-foreground">
          Sign in
        </Link>
      </p>
    </main>
  );
}
