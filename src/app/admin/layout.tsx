import Link from "next/link";
import { requireAdmin } from "@/lib/api-server";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireAdmin();

  return (
    <main className="flex min-h-screen flex-col items-center gap-6 p-8">
      <div className="flex w-full max-w-3xl items-center justify-between">
        <div className="flex items-center gap-4">
          <h1 className="text-2xl font-bold">Admin</h1>
          <nav className="flex gap-4 text-sm text-muted-foreground">
            <Link href="/admin/programs" className="hover:text-foreground">
              Programs
            </Link>
            <Link href="/admin/members" className="hover:text-foreground">
              Members
            </Link>
          </nav>
        </div>
        <Link href="/" className="text-sm text-muted-foreground hover:text-foreground">
          ← Back
        </Link>
      </div>
      {children}
    </main>
  );
}
