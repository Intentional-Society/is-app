import type { Metadata } from "next";

import { HelpHint } from "@/components/help-hint";
import { PageHeader } from "@/components/page-header";
import { requireUser, serverApiClient } from "@/lib/api-server";
import type { Intention } from "@/lib/api-types";
import { titleFor } from "@/lib/page-titles";

import { IntentionsCloud } from "./intentions-cloud";

export const metadata: Metadata = { title: titleFor("/intentions") };

export default async function IntentionsPage() {
  await requireUser();

  const res = await serverApiClient.api.intentions.$get();
  if (!res.ok) throw new Error(`Failed to load intentions: ${res.status}`);
  const { intentions }: { intentions: Intention[] } = await res.json();

  return (
    <main className="flex min-h-screen flex-col items-center gap-6 px-8 pb-8 pt-3">
      <PageHeader
        title="Current intentions"
        hint={
          <HelpHint label="About current intentions">
            Freshest intentions sit in the centre. Hover or tap to read one in full; click to open a member.
          </HelpHint>
        }
      />

      {/* Intro sits in the visualization's column (max-w-2xl, like the
       * cloud below), so the header row stays a slim title bar. */}
      <div className="w-full max-w-2xl">
        <p className="text-sm text-muted-foreground">What the network is working toward right now.</p>
        <p className="mt-1 max-w-md text-xs text-muted-foreground">
          NOTE: This page is a first draft, and we&apos;re still figuring out how to visualize and browse for
          serendipity — feedback welcome!
        </p>
      </div>

      <IntentionsCloud intentions={intentions} />
    </main>
  );
}
