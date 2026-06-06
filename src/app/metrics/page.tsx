import { BreadcrumbLink } from "@/components/breadcrumb-link";
import { requireUser } from "@/lib/api-server";

import { SystemMetrics } from "./system-metrics";

// Open to any signed-in member, not just admins — these are the community
// figures the whole network can see. requireUser handles the redirect for
// signed-out visitors.
export default async function MetricsPage() {
  await requireUser();

  return (
    <main className="flex min-h-screen flex-col items-center gap-6 p-8">
      <div className="flex w-full max-w-xl items-center justify-between">
        <h1 className="text-2xl font-bold">System Metrics</h1>
        <BreadcrumbLink fallback="/" />
      </div>
      <section className="w-full max-w-xl">
        <SystemMetrics />
      </section>
    </main>
  );
}
