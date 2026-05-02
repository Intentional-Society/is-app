import Link from "next/link";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

import { ProgramsList } from "./programs-list";

export default async function ProgramsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/signin");

  return (
    <main className="flex min-h-screen flex-col items-center gap-6 p-8">
      <div className="flex w-full max-w-xl items-center justify-between">
        <h1 className="text-2xl font-bold">Programs</h1>
        <Link href="/" className="text-sm text-gray-400 hover:text-gray-500">
          ← Back
        </Link>
      </div>
      <p className="w-full max-w-xl text-sm text-gray-400">
        Browse programs and join the ones that interest you.
      </p>
      <ProgramsList />
    </main>
  );
}
