"use client";

import dynamic from "next/dynamic";
import type { Controls, EventData, Step } from "react-joyride";

// react-joyride v3 reads `window` at module load, which would crash the
// SSR of any client component that imports it. dynamic + ssr:false keeps
// it client-only. Joyride is a named export, so wrap it into a default.
const Joyride = dynamic(() => import("react-joyride").then((m) => ({ default: m.Joyride })), { ssr: false });

// The capstone after a first-time member clicks Done — the explicit
// "onboarding is over" moment (#399). It spotlights the whole top bar
// so the home icon and the menu light up together; the way onward
// doubles as the lesson.
const STEPS: Step[] = [
  {
    target: "[data-tour='top-bar']",
    title: "You're all set!",
    placement: "bottom",
    content: (
      <>
        That&apos;s the whole tour — your web is saved, and you can hit &quot;Edit&quot; to add more relationships.
        <br />
        <br />
        Up top: the house (left) takes you home, and the menu (right) opens everything else. Welcome to the IS Web App!
      </>
    ),
  },
];

// One step, so the only endings are user-driven: "Thanks!" (last) or
// close. The primary-button completion arrives with action "update"
// (joyride's internal finish transition), so it's detected via
// status === "finished" — which only completion produces; run=false
// teardowns pause without a tour:end. Skip/close keep the action-verb
// filter from WelcomeTour, since status "skipped" also fires on passive
// teardowns (HMR, navigation) and must not count as a dismissal.
export function FarewellTour({ run, onClose }: { run: boolean; onClose: () => void }) {
  const handleEvent = (data: EventData, _controls: Controls) => {
    if (data.type === "tour:end" && (data.status === "finished" || data.action === "skip" || data.action === "close")) {
      onClose();
    }
  };

  return (
    <Joyride
      steps={STEPS}
      run={run}
      onEvent={handleEvent}
      continuous
      locale={{ last: "Thanks!" }}
      options={{
        // The tooltip should appear immediately, not as a pulse beacon.
        skipBeacon: true,
        buttons: ["primary"],
        // Dismissal is an intentional act (the Thanks! button), not an
        // errant background click.
        overlayClickAction: false,
        // Project teal, matches the rest of the palette closely enough.
        primaryColor: "#4a7c7a",
        zIndex: 10000,
      }}
    />
  );
}
