import type { ReactNode } from "react";

import { WelcomeStepper } from "./welcome-stepper";

// Shared shell for the multi-step welcome flow. Each step page
// (/welcome/agreements, /welcome/profile, /welcome/programs) renders its
// content inside this; the stepper shows where the member is.
export default function WelcomeLayout({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-screen flex-col items-center gap-6 p-8">
      {children}
      <WelcomeStepper />
    </main>
  );
}
