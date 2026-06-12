import { PageHeader } from "@/components/page-header";
import { requireUser } from "@/lib/api-server";

import { ProgramsList } from "./programs-list";

export default async function ProgramsPage() {
  await requireUser();

  return (
    <main className="flex min-h-screen flex-col items-center gap-6 px-8 pb-8 pt-3">
      <PageHeader title="Programs" />
      <p className="w-full max-w-5xl text-base text-muted-foreground">
        Browse programs and join the ones that interest you.
      </p>
      <ProgramsList />
    </main>
  );
}
