import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { PageHeader } from "@/components/page-header";
import { requireUser, serverApiClient } from "@/lib/api-server";
import { titleFor } from "@/lib/page-titles";

import { AdminHidden } from "./admin-hidden";
import { AdminHints } from "./admin-hints";
import { ButtondownSyncButtons } from "./buttondown-sync-buttons";

export const metadata: Metadata = { title: titleFor("/admin") };

export default async function AdminPage() {
  const me = await requireUser();
  const profile = me.profile;
  // Generic 404 for non-admins so the page doesn't advertise itself.
  if (!profile?.isAdmin) notFound();

  const res = await serverApiClient.api.admin.appsettings.$get();
  if (!res.ok) throw new Error(`Failed to load app settings: ${res.status}`);
  const { appSettings } = await res.json();

  return (
    <main className="flex min-h-screen flex-col items-center gap-6 px-8 pb-8 pt-3">
      <PageHeader title="Admin" />

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
        <h2 className="text-lg font-semibold">Invites</h2>
        <Link
          href="/admin/invites"
          className="text-sm text-muted-foreground underline hover:text-foreground hover:no-underline"
        >
          Manage invites →
        </Link>
      </section>

      <section className="flex w-full max-w-xl flex-col gap-2">
        <h2 className="text-lg font-semibold">Members</h2>
        <Link
          href="/admin/members"
          className="text-sm text-muted-foreground underline hover:text-foreground hover:no-underline"
        >
          Manage members →
        </Link>
        <Link
          href="/admin/signins"
          className="text-sm text-muted-foreground underline hover:text-foreground hover:no-underline"
        >
          View sign-ins →
        </Link>
      </section>

      <section className="flex w-full max-w-xl flex-col gap-2">
        <h2 className="text-lg font-semibold">Web</h2>
        <AdminHints />
      </section>

      <section className="flex w-full max-w-xl flex-col gap-2">
        <h2 className="text-lg font-semibold">Hidden accounts</h2>
        <AdminHidden />
      </section>

      <section className="flex w-full max-w-xl flex-col gap-2">
        <h2 className="text-lg font-semibold">Buttondown sync</h2>
        <ButtondownSyncButtons />
      </section>
    </main>
  );
}
