import { redirect } from "next/navigation";

import { requireUser } from "@/lib/api-server";
import { welcomeEntryStep } from "@/lib/welcomeEntryStep";

// The welcome flow has no landing screen of its own: /welcome forwards
// to the member's first unfinished step, or to /myweb once onboarding is
// done. Each step returns here after stamping its marker, so this single
// recompute drives all forward progress. See docs/design-welcome.md.
export default async function WelcomeIndexPage() {
  const me = await requireUser();
  const step = welcomeEntryStep(me.profile);
  redirect(step ? `/welcome/${step}` : "/myweb");
}
