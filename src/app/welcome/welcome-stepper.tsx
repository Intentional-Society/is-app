"use client";

import { usePathname } from "next/navigation";

const STEPS = [
  { path: "/welcome/agreements", label: "Welcome" },
  { path: "/welcome/profile", label: "Profile" },
  { path: "/welcome/programs", label: "Programs" },
  { path: "/myweb", label: "My Web" },
];

// Progress indicator for the welcome flow. Uses the pathname rather than
// a prop because the layout that renders it is shared across all step
// routes. The /welcome index redirects before render, so an unmatched
// pathname renders nothing.
export function WelcomeStepper() {
  const pathname = usePathname();
  const current = STEPS.findIndex((step) => pathname.startsWith(step.path));
  if (current < 0) return null;

  return (
    <ol className="flex items-center gap-3 text-sm" aria-label="Onboarding progress">
      {STEPS.map((step, i) => (
        <li
          key={step.path}
          aria-current={i === current ? "step" : undefined}
          className={i === current ? "font-semibold text-foreground" : "text-muted-foreground"}
        >
          {i + 1}. {step.label}
        </li>
      ))}
    </ol>
  );
}
