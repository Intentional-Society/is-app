import { requireAdmin, serverApiClient } from "@/lib/api-server";
import { ProgramsAdminPanel } from "./programs-admin-panel";

export default async function AdminProgramsPage() {
  await requireAdmin();
  const res = await serverApiClient.api.admin.programs.$get();
  if (!res.ok) throw new Error("Failed to load programs");
  const { programs } = await res.json();
  return <ProgramsAdminPanel programs={programs} />;
}
