import { BreadcrumbLink } from "@/components/breadcrumb-link";
import { requireUser } from "@/lib/api-server";

import { InvitesPanel } from "./invites-panel";

export default async function InvitesPage() {
  const me = await requireUser();

  return (
    <main className="flex min-h-screen flex-col items-center gap-6 p-8">
      <div className="flex w-full max-w-xl items-center justify-between">
        <h1 className="text-2xl font-bold">Invites</h1>
        <BreadcrumbLink fallback="/" />
      </div>
      <InvitesPanel me={me} />
    </main>
  );
}
