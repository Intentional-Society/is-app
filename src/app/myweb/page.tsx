import Link from "next/link";

import { requireUser } from "@/lib/api-server";

export default async function MyWebPage() {
  await requireUser();

  return (
    <main className="flex min-h-screen flex-col items-center gap-6 p-8">
      <div className="flex w-full max-w-5xl items-center justify-between">
        <h1 className="text-2xl font-bold">My web</h1>
        <Link href="/" className="text-base text-muted-foreground hover:text-foreground">
          ← Back
        </Link>
      </div>
      <p className="text-muted-foreground">Coming soon — your personal subgraph and suggestion feed.</p>
    </main>
  );
}
