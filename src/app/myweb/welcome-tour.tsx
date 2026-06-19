"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef } from "react";
import type { Controls, EventData, Step } from "react-joyride";

// react-joyride v3 reads `window` at module load, which would crash the
// SSR of any client component that imports it. dynamic + ssr:false keeps
// it client-only. Joyride is a named export, so wrap it into a default.
const Joyride = dynamic(() => import("react-joyride").then((m) => ({ default: m.Joyride })), { ssr: false });

const STEPS: Step[] = [
  {
    target: "body",
    placement: "center",
    title: "Mapping your relational web",
    content: "A network is made of connections — mapping them is hopefully fun and useful! We'll show you how...",
  },
  {
    target: "[data-tour='add-people']",
    title: "Adding people you know",
    content: "Click anyone here, and say how well you know them. Go ahead and try one now!",
    placement: "top",
  },
  {
    target: "[data-tour='graph']",
    title: "Seeing your web",
    content: "Your connections show up here. The ? in the corner has more navigation tips.",
    placement: "bottom",
  },
  {
    target: "[data-tour='done-button']",
    title: "Finish by clicking Done",
    content:
      "No notifications are sent, but your relations become hints for others. Click Done now! (You can add more anytime.)",
    // Done now sits in the canvas's lower-left corner, so the tooltip floats
    // above it (left would push it off the canvas edge).
    placement: "top",
    // No primary button on the final step — the spotlighted Done
    // button on the page is the only finisher.
    buttons: ["back", "skip"],
  },
];

// Only user-driven tour endings should set the session-dismissed flag.
// Filter on data.action — not data.status — because status="skipped"
// also fires on passive teardowns (HMR, parent re-render, navigating
// away mid-tour), which would otherwise poison sessionStorage and hide
// the tour from that tab forever. Pairing tour:end with action verbs
// (skip / close / next-on-last-step) leaves passive teardowns alone.
export function WelcomeTour({
  run,
  advanceToken,
  onClose,
}: {
  run: boolean;
  // Increment from the parent to programmatically advance the tour by
  // one step (e.g. after the user completes the step's action). The
  // ref-vs-prop comparison below ignores the initial value, so a fresh
  // mount (replay path) doesn't auto-advance.
  advanceToken: number;
  onClose: () => void;
}) {
  const controlsRef = useRef<Controls | null>(null);
  const lastAdvanceTokenRef = useRef(advanceToken);

  useEffect(() => {
    if (advanceToken === lastAdvanceTokenRef.current) return;
    lastAdvanceTokenRef.current = advanceToken;
    controlsRef.current?.next();
  }, [advanceToken]);

  const handleEvent = (data: EventData, controls: Controls) => {
    controlsRef.current = controls;
    if (data.type === "tour:end" && (data.action === "skip" || data.action === "close" || data.action === "next")) {
      onClose();
    }
  };

  return (
    <Joyride
      steps={STEPS}
      run={run}
      onEvent={handleEvent}
      // continuous=true makes the primary button advance through steps
      continuous
      locale={{ skip: "Dismiss tour" }}
      options={{
        // skipBeacon means the tooltip appears immediately instead of
        // showing the pulse beacon first — better for a guided welcome.
        skipBeacon: true,
        showProgress: true,
        // Default buttons drop 'skip'; we want a one-click out for users
        // who'd rather poke around themselves.
        buttons: ["back", "skip", "primary"],
        // Default is "close"; users reported losing the tour to errant
        // background clicks. Dismiss is now an intentional act via the
        // Dismiss tour button.
        overlayClickAction: false,
        // Project teal, matches the rest of the palette closely enough.
        primaryColor: "#4a7c7a",
        zIndex: 10000,
      }}
    />
  );
}
