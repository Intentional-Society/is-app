"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { applyThemePreference, readThemePreference, type ThemePreference } from "@/lib/theme";

const OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
];

export function ThemeSelector() {
  // The stored preference lives in localStorage, which the server can't
  // see — start unselected and read it after mount so server and client
  // render the same initial markup.
  const [pref, setPref] = useState<ThemePreference | null>(null);

  useEffect(() => {
    setPref(readThemePreference());
  }, []);

  const select = (next: ThemePreference) => {
    applyThemePreference(next);
    setPref(next);
  };

  return (
    <div role="radiogroup" aria-label="Theme" className="flex gap-2">
      {OPTIONS.map(({ value, label }) => (
        <Button
          key={value}
          role="radio"
          aria-checked={pref === value}
          variant={pref === value ? "secondary" : "primary"}
          size="sm"
          onClick={() => select(value)}
        >
          {label}
        </Button>
      ))}
    </div>
  );
}
