import type { Metadata } from "next";

import { PageHeader } from "@/components/page-header";
import { requireUser } from "@/lib/api-server";
import type { Me } from "@/lib/api-types";
import { titleFor } from "@/lib/page-titles";

import { MeTabs } from "./me-tabs";

export const metadata: Metadata = { title: titleFor("/me") };

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
    <main className="flex min-h-screen flex-col items-center gap-6 px-8 pb-8 pt-3">
      <PageHeader title="My page" />

      {me.profile.hidden && (
        <p role="alert" className="w-full max-w-md rounded-md border border-border bg-muted px-4 py-3 text-sm">
          Your account is marked as hidden, and won&apos;t show in the Directory or Webs. Please reach out to{" "}
          <a href="mailto:devteam@mail.intentionalsociety.org" className="underline hover:text-muted-foreground">
            devteam@mail.intentionalsociety.org
          </a>{" "}
          if you don&apos;t know why.
        </p>
      )}

      <MeTabs profile={me.profile} />
    </main>
  );
}
