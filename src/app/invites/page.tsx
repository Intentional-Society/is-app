import Link from "next/link";

import { requireUser } from "@/lib/api-server";

import { InvitesPanel } from "./invites-panel";

export default async function InvitesPage() {
  await requireUser();

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
