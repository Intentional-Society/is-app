import { BreadcrumbLink } from "@/components/breadcrumb-link";
import { requireUser } from "@/lib/api-server";
import type { Me } from "@/lib/api-types";

import { MeTabs } from "./me-tabs";

// /me replaces /profile and /profile/edit (#376): one page, two
// anchor-linked tabs — Profile (editing-first, with a link out to the
// directory view) and Settings (theme, profile URL, emergency contact,
// password, deactivation).
export default async function MePage() {
  const me: Me = await requireUser();
  // /api/me self-heals a missing profile row, so this is effectively
  // unreachable — the guard keeps the type honest and fails loudly if
  // that invariant ever breaks.
  if (!me.profile) throw new Error("authenticated user has no profile");

  return (
    <main className="flex min-h-screen flex-col items-center gap-6 p-8">
      <div className="flex w-full max-w-md items-center justify-between">
        <h1 className="text-2xl font-bold">My page</h1>
        <BreadcrumbLink fallback="/" />
      </div>

      <MeTabs profile={me.profile} />
    </main>
  );
}
