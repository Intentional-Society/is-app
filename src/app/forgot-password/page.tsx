import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { getServerUser } from "@/lib/supabase/server-user";

import { ForgotPasswordForm } from "./forgot-password-form";

// Public page — opt back in to indexing (root layout is noindex by default).
export const metadata: Metadata = { robots: { index: true, follow: true } };

export default async function ForgotPasswordPage() {
  const user = await getServerUser();
  if (user) {
    redirect("/");
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
      <h1 className="text-4xl font-bold">Intentional Society</h1>
      <p className="max-w-sm text-center text-base text-muted-foreground">
        Enter your email and we will send you a link to reset your password.
      </p>
      <ForgotPasswordForm />
      <p className="text-base text-muted-foreground">
        <Link href="/signin" className="underline text-muted-foreground hover:text-foreground">
          Back to sign in
        </Link>
      </p>
    </main>
  );
}
