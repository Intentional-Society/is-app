import { requireUser } from "@/lib/api-server";

import { WelcomeAdvanceButton } from "../welcome-advance-button";
import { AgreementsContent } from "./agreements-content";

// Step 1 of the welcome flow: a welcome message and the community
// agreements. "I agree" stamps lastSignedAgreements and advances.
export default async function WelcomeAgreementsPage() {
  const me = await requireUser();

  // A non-empty bio means the member has already set up their profile, so
  // treat this as a returning member reviewing agreements they've signed
  // before rather than seeing them for the first time.
  const hasProfile = Boolean(me.profile?.bio);

  return (
    <>
      <AgreementsContent hasProfile={hasProfile} />
      <WelcomeAdvanceButton step="agreements" label="I agree" />
    </>
  );
}
