"use client";

import dynamic from "next/dynamic";
import type { Controls, EventData, Step } from "react-joyride";

// react-joyride v3 reads `window` at module load, which would crash the
// SSR of any client component that imports it. dynamic + ssr:false keeps
// it client-only. Joyride is a named export, so wrap it into a default.
const Joyride = dynamic(() => import("react-joyride").then((m) => ({ default: m.Joyride })), { ssr: false });

// The title doubles as the save confirmation: the tour only fires on a
// successful save, and its overlay+scroll hides the form's own status
// line, so this is the feedback the member actually reads.
const STEPS: Step[] = [
  {
    target: "[data-tour='settings-tab']",
    title: "Profile saved!",
    placement: "bottom",
    content:
      "One more thing — your password, emergency contact, profile address, and theme live here. Take a look before you continue.",
  },
];

// One step, so the only endings are user-driven: "Got it" (last) or
// close. Same action-verb filtering as myweb's WelcomeTour — passive
// teardowns (HMR, navigation) fire status changes too and must not
// count as a dismissal.
export function WelcomeSettingsTour({ run, onClose }: { run: boolean; onClose: () => void }) {
  const handleEvent = (data: EventData, _controls: Controls) => {
    if (data.type === "tour:end" && (data.action === "skip" || data.action === "close" || data.action === "next")) {
      onClose();
    }
  };

  return (
    <Joyride
      steps={STEPS}
      run={run}
      onEvent={handleEvent}
      continuous
      locale={{ last: "Got it" }}
      options={{
        // The tooltip should appear immediately, not as a pulse beacon.
        skipBeacon: true,
        buttons: ["primary"],
        // Dismissal is an intentional act (the Got it button), not an
        // errant background click.
        overlayClickAction: false,
        // Project teal, matches the rest of the palette closely enough.
        primaryColor: "#4a7c7a",
        zIndex: 10000,
      }}
    />
  );
}
