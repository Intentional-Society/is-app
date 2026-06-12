import { PageHeader } from "@/components/page-header";
import { requireUser } from "@/lib/api-server";

import { InvitesPanel } from "./invites-panel";

export default async function InvitesPage() {
  const me = await requireUser();

  return (
    <main className="flex min-h-screen flex-col items-center gap-6 px-8 pb-8 pt-3">
      <PageHeader title="Invites" />
      <InvitesPanel me={me} />
    </main>
  );
}
