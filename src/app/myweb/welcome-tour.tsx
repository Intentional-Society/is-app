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

// Only user-driven tour endings should set the session-dismissed flag.
// Filter on data.action — not data.status — because status="skipped"
// also fires on passive teardowns (HMR, parent re-render, navigating
// away mid-tour), which would otherwise poison sessionStorage and hide
// the tour from that tab forever. Pairing tour:end with action verbs
// (skip / close / next-on-last-step) leaves passive teardowns alone.
export function WelcomeTour({ run, onClose }: { run: boolean; onClose: () => void }) {
  const handleEvent = (data: EventData) => {
    if (
      data.type === "tour:end" &&
      (data.action === "skip" || data.action === "close" || data.action === "next")
    ) {
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
