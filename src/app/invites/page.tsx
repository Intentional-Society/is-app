import Link from "next/link";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

import { InvitesPanel } from "./invites-panel";

export default async function InvitesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/signin");
  }

  return (
    <main className="flex min-h-screen flex-col items-center gap-6 p-8">
      <h1 className="text-4xl font-bold">Intentional Society</h1>
      <Link href="/" className="text-base text-muted-foreground underline hover:text-foreground">
        ← Back to home
      </Link>
      <InvitesPanel />
    </main>
  );
}
