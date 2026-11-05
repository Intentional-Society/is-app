import { Suspense } from "react";

import { MESSAGE_BOX_FEATURE } from "@/lib/program-features";

import { MessageBoxFallback, MessageBoxSection } from "./message-box-section";

// One section per attached program feature (docs/design-programs.md,
// "Rendering"). Each is an async Server Component in its own <Suspense>, so
// sections fetch in parallel and a slow one delays only itself. A new feature
// adds its section here; the page itself stays feature-agnostic.
export function FeatureSections({ programId, features }: { programId: string; features: string[] }) {
  return (
    <>
      {features.includes(MESSAGE_BOX_FEATURE) && (
        <Suspense fallback={<MessageBoxFallback />}>
          <MessageBoxSection programId={programId} />
        </Suspense>
      )}
    </>
  );
}
