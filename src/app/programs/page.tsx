import { BreadcrumbLink } from "@/components/breadcrumb-link";
import { requireUser } from "@/lib/api-server";

import { ProgramsList } from "./programs-list";

export default async function ProgramsPage() {
  await requireUser();

  return (
    <main className="flex min-h-screen flex-col items-center gap-6 p-8">
      <div className="flex w-full max-w-5xl items-center justify-between">
        <h1 className="text-2xl font-bold">Programs</h1>
        <BreadcrumbLink fallback="/" />
      </div>
      <p className="w-full max-w-5xl text-base text-muted-foreground">
        Browse programs and join the ones that interest you.
      </p>
      <ProgramsList />
    </main>
  );
}
