import { requireUser } from "@/lib/api-server";

import { ProgramsList } from "../../programs/programs-list";
import { WelcomeAdvanceButton } from "../welcome-advance-button";

// Step 3 of the welcome flow: browse and join programs. "Done" stamps
// lastReviewedPrograms and advances, completing onboarding.
export default async function WelcomeProgramsPage() {
  await requireUser();

  return (
    <>
      <div className="flex flex-col items-center gap-3 text-center">
        <h1 className="text-4xl font-bold">Programs</h1>
        <p className="max-w-md text-base text-muted-foreground">
          These programs are open to new participants — join any that you’d like to sign up for. (We added
          one for you, opt out if you like.)
        </p>
      </div>
      <ProgramsList />
      <WelcomeAdvanceButton step="programs" label="Done" />
    </>
  );
}
