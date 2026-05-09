import Link from "next/link";

import { requireUser } from "@/lib/api-server";

import { MyWeb } from "./my-web";

export default async function MyWebPage() {
  const me = await requireUser();
  // ProfileForSelf surfaces lastUpdatedWeb as a Date; the JSON wire
  // arrives as an ISO string, so reconstruct here for the client.
  const raw = me.profile?.lastUpdatedWeb ?? null;
  const initialLastUpdatedWeb = typeof raw === "string" ? new Date(raw) : raw;

  return (
    <main className="flex min-h-screen flex-col items-center gap-6 p-8">
      <div className="flex w-full max-w-5xl items-center justify-between">
        <h1 className="text-2xl font-bold">My web</h1>
        <Link href="/" className="text-base text-muted-foreground hover:text-foreground">
          ← Back
        </Link>
      </div>
      <MyWeb initialLastUpdatedWeb={initialLastUpdatedWeb} />
    </main>
  );
}
