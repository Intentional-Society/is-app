"use client";

import dynamic from "next/dynamic";
import type { EventData, Step } from "react-joyride";

// react-joyride v3 reads `window` at module load, which would crash the
// SSR of any client component that imports it. dynamic + ssr:false keeps
// it client-only. Joyride is a named export, so wrap it into a default.
const Joyride = dynamic(() => import("react-joyride").then((m) => ({ default: m.Joyride })), { ssr: false });

const STEPS: Step[] = [
  {
    target: "body",
    placement: "center",
    title: "Welcome to your relational web",
    content: "This page is yours. Add a few people you know to bring it to life — we'll show you how.",
  },
  {
    target: "[data-tour='add-people']",
    title: "Add people you know",
    content: "Click anyone here to set how you know them. Each rating draws a new edge on your web.",
    placement: "top",
  },
  {
    target: "[data-tour='done-button']",
    title: "Click Done when you're ready",
    content: "Done marks you as recently active and switches to view mode. You can come back and edit anytime.",
    placement: "left",
  },
];

// Renders Joyride only while `run` is true. The parent (MyWeb) flips it
// off when the user clicks Done — the markDone mutation succeeds and
// the tour vanishes. Joyride finishing on its own (last-step Next or
// the skip/close action) also closes the tour for this session.
export function WelcomeTour({ run, onClose }: { run: boolean; onClose: () => void }) {
  const handleEvent = (data: EventData) => {
    if (data.status === "finished" || data.status === "skipped") {
      onClose();
    }
  };

  return (
    <Joyride
      steps={STEPS}
      run={run}
      onEvent={handleEvent}
      options={{
        // skipBeacon means the tooltip appears immediately instead of
        // showing the pulse beacon first — better for a guided welcome.
        skipBeacon: true,
        showProgress: true,
        // Default buttons drop 'skip'; we want a one-click out for users
        // who'd rather poke around themselves.
        buttons: ["back", "skip", "primary"],
        // Project teal, matches the rest of the palette closely enough.
        primaryColor: "#4a7c7a",
        zIndex: 10000,
      }}
    />
  );
}
