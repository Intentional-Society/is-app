import { requireAdmin, serverApiClient } from "@/lib/api-server";
import { MembersAdminPanel } from "./members-admin-panel";

export default async function AdminMembersPage() {
  const me = await requireAdmin();
  const res = await serverApiClient.api.admin.members.$get();
  if (!res.ok) throw new Error("Failed to load members");
  const { members } = await res.json();
  return <MembersAdminPanel members={members} currentUserId={me.id} />;
}
