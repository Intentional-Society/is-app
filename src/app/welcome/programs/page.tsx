import type { Metadata } from "next";

import { requireUser } from "@/lib/api-server";
import { titleFor } from "@/lib/page-titles";

import { ProgramsList } from "../../programs/programs-list";
import { WelcomeAdvanceButton } from "../welcome-advance-button";

export const metadata: Metadata = { title: titleFor("/welcome/programs") };

// Step 3 of the welcome flow: browse and join programs. "Done" stamps
// lastReviewedPrograms and advances, completing onboarding.
export default async function WelcomeProgramsPage() {
  await requireUser();

  return (
    <>
      <div className="flex flex-col items-center gap-3 text-center">
        <h1 className="text-4xl font-bold">Programs</h1>
        <p className="max-w-md text-base text-muted-foreground">
          These programs are open to new participants — join any that you’d like to sign up for. (Note: Weekly Web
          Updates defaults to on/joined.)
        </p>
      </div>
      <ProgramsList />
      <WelcomeAdvanceButton step="programs" label="Done" />
    </>
  );
}
