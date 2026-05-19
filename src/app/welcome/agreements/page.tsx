import { requireUser } from "@/lib/api-server";

import { WelcomeAdvanceButton } from "../welcome-advance-button";
import { AgreementsContent } from "./agreements-content";

// Step 1 of the welcome flow: a welcome message and the community
// agreements. "I agree" stamps lastSignedAgreements and advances.
export default async function WelcomeAgreementsPage() {
  await requireUser();

  return (
    <>
      <AgreementsContent />
      <WelcomeAdvanceButton step="agreements" label="I agree" />
    </>
  );
}
