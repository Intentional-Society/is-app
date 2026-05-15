import Link from "next/link";

export default function AdminPage() {
  return (
    <div className="flex w-full max-w-3xl flex-col gap-4">
      <p className="text-muted-foreground">
        Manage programs and members for Intentional Society.
      </p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Link
          href="/admin/programs"
          className="rounded border border-border p-6 hover:bg-muted/50 transition-colors"
        >
          <h2 className="font-semibold">Programs</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Create, edit, and manage program membership.
          </p>
        </Link>
        <Link
          href="/admin/members"
          className="rounded border border-border p-6 hover:bg-muted/50 transition-colors"
        >
          <h2 className="font-semibold">Members</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            View all members and manage admin access.
          </p>
        </Link>
      </div>
    </div>
  );
}
