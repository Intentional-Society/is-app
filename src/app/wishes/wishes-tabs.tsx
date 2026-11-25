"use client";

import type { ReactNode } from "react";
import { useState } from "react";

export function WishesTabs({ myWishes, discover }: { myWishes: ReactNode; discover: ReactNode }) {
  const [tab, setTab] = useState<"mine" | "discover">("mine");

  return (
    <div className="flex w-full max-w-5xl flex-col gap-6">
      <div className="flex gap-1 rounded-lg border border-border bg-muted/40 p-1">
        {(["mine", "discover"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={[
              "flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              tab === t ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
            ].join(" ")}
          >
            {t === "mine" ? "My Wishes" : "Discover"}
          </button>
        ))}
      </div>

      {tab === "mine" ? myWishes : discover}
    </div>
  );
}
