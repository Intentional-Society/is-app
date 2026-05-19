import Link from "next/link";
import { notFound } from "next/navigation";

import { requireUser, serverApiClient } from "@/lib/api-server";

import { AdminHints } from "./admin-hints";

export default async function AdminPage() {
  const me = await requireUser();
  // Generic 404 for non-admins so the page doesn't advertise itself.
  if (!me.profile?.isAdmin) notFound();

  const res = await serverApiClient.api.admin.appsettings.$get();
  if (!res.ok) throw new Error(`Failed to load app settings: ${res.status}`);
  const { appSettings } = await res.json();

  return (
    <main className="flex min-h-screen flex-col items-center gap-6 p-8">
      <div className="flex w-full max-w-xl items-center justify-between">
        <h1 className="text-2xl font-bold">Admin</h1>
        <Link href="/" className="text-base text-muted-foreground hover:text-foreground">
          ← Back
        </Link>
      </div>

      <section className="flex w-full max-w-xl flex-col gap-2">
        <h2 className="text-lg font-semibold">App settings</h2>
        {Object.keys(appSettings).length === 0 ? (
          <p className="text-sm text-muted-foreground">No settings yet.</p>
        ) : (
          <pre className="rounded border border-border bg-muted/50 p-3 text-xs">
            {JSON.stringify(appSettings, null, 2)}
          </pre>
        )}
      </section>

      <section className="flex w-full max-w-xl flex-col gap-2">
        <h2 className="text-lg font-semibold">Programs</h2>
        <Link
          href="/admin/programs"
          className="text-sm text-muted-foreground underline hover:text-foreground hover:no-underline"
        >
          Manage programs →
        </Link>
      </section>

      <section className="flex w-full max-w-xl flex-col gap-2">
        <h2 className="text-lg font-semibold">Web</h2>
        <AdminHints />
      </section>
    </main>
  );
}
