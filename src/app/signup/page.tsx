import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

import { SignupForm } from "./signup-form";

type SignupPageProps = {
  searchParams: Promise<{ code?: string }>;
};

export default async function SignupPage({ searchParams }: SignupPageProps) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) {
    // Already signed in — nothing to do here.
    redirect("/");
  }

  const { code } = await searchParams;

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
      <h1 className="text-4xl font-bold">Intentional Society</h1>
      <p className="max-w-sm text-center text-sm text-gray-400">
        Joining by invite? Enter the code a member shared with you.
      </p>
      <SignupForm initialCode={code ?? ""} />
    </main>
  );
}
