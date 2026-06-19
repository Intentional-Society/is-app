"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { SettingsSections } from "@/app/me/settings-sections";
import { AvatarUploader } from "@/components/avatar-uploader";
import { Tab, TabBar } from "@/components/tabs";
import { Button } from "@/components/ui/button";
import type { Me } from "@/lib/api-types";
import { cn } from "@/lib/utils";

import { WelcomeForm } from "./welcome-form";
import { WelcomeSettingsTour } from "./welcome-settings-tour";

type TabId = "profile" | "settings";

// The welcome profile step wears the same tabs as /me, so members meet
// the page shape they'll use from then on. Saving the profile opens the
// Settings tab itself — members told "your settings live here" weren't
// finding the tab (#399) — and fires a one-step tour over the revealed
// panel, plus the Continue button that advances the flow. Tabs only
// swap panels here (no URL change), so they're buttons, not anchors.
export function WelcomeTabs({ profile }: { profile: Me["profile"] }) {
  const router = useRouter();
  const [tab, setTab] = useState<TabId>("profile");
  const [saved, setSaved] = useState(false);
  const [tourDismissed, setTourDismissed] = useState(false);

  // A manual tab switch while the tour is up means the member is already
  // navigating — don't leave the tooltip hanging over the wrong panel.
  const switchTab = (id: TabId) => {
    setTab(id);
    setTourDismissed(true);
  };

  return (
    <>
      <TabBar ariaLabel="Profile and settings">
        <Tab active={tab === "profile"} onClick={() => switchTab("profile")}>
          Profile
        </Tab>
        <Tab active={tab === "settings"} onClick={() => switchTab("settings")}>
          Settings
        </Tab>
      </TabBar>

      <section
        aria-label="Profile"
        className={cn("w-full max-w-md flex-col items-center gap-6", tab === "profile" ? "flex" : "hidden")}
      >
        <AvatarUploader name={profile?.displayName ?? null} initialUrl={profile?.avatarUrl ?? null} />
        <WelcomeForm
          initial={{
            displayName: profile?.displayName ?? "",
            bio: profile?.bio ?? "",
            keywords: profile?.keywords ?? [],
            location: profile?.location ?? "",
            supplementaryInfo: profile?.supplementaryInfo ?? "",
            currentIntention: profile?.currentIntention ?? "",
          }}
          onSaved={() => {
            setSaved(true);
            setTab("settings");
          }}
        />
      </section>

      <section
        aria-label="Settings"
        data-tour="settings-panel"
        className={cn("w-full max-w-md flex-col gap-6", tab === "settings" ? "flex" : "hidden")}
      >
        <SettingsSections
          profile={{
            slug: profile?.slug ?? null,
            emergencyContact: profile?.emergencyContact ?? null,
            deactivatedAt: profile?.deactivatedAt ?? null,
            hasPassword: profile?.hasPassword ?? false,
          }}
          includeDeactivate={false}
        />
      </section>

      {saved && (
        <div className="w-full max-w-md border-t border-border pt-6">
          <Button
            variant="secondary"
            className="w-full"
            onClick={() => {
              // Same handoff the form itself used to do: back to the
              // /welcome index, which routes on to the next step.
              router.push("/welcome");
              router.refresh();
            }}
          >
            Continue
          </Button>
        </div>
      )}

      <WelcomeSettingsTour run={saved && !tourDismissed} onClose={() => setTourDismissed(true)} />
    </>
  );
}
