import { BreadcrumbLink } from "@/components/breadcrumb-link";
import { HelpHint } from "@/components/help-hint";
import { requireUser, serverApiClient } from "@/lib/api-server";
import type { Intention } from "@/lib/api-types";

import { IntentionsCloud } from "./intentions-cloud";

export default async function IntentionsPage() {
  await requireUser();

  const res = await serverApiClient.api.intentions.$get();
  if (!res.ok) throw new Error(`Failed to load intentions: ${res.status}`);
  const { intentions }: { intentions: Intention[] } = await res.json();

  return (
    <main className="flex min-h-screen flex-col items-center gap-6 p-8">
      <div className="flex w-full max-w-2xl items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold">Current intentions</h1>
            <HelpHint label="About current intentions">
              Freshest intentions sit in the centre. Hover or tap to read one in full; click to open a member.
            </HelpHint>
          </div>
          <p className="text-sm text-muted-foreground">What the network is working toward right now.</p>
          <p className="mt-1 max-w-md text-xs text-muted-foreground">
            NOTE: This page is a first draft, and we&apos;re still figuring out how to visualize and browse for
            serendipity — feedback welcome!
          </p>
        </div>
        <BreadcrumbLink fallback="/" />
      </div>

      <IntentionsCloud intentions={intentions} />
    </main>
  );
}
