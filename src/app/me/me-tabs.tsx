"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { AvatarUploader } from "@/components/avatar-uploader";
import { Tab, TabBar } from "@/components/tabs";
import type { Me } from "@/lib/api-types";
import { cn } from "@/lib/utils";

import { ProfileForm } from "./profile-form";
import { SettingsSections } from "./settings-sections";

type TabId = "profile" | "settings";

// Anchor-link tabs (#376): /me#profile and /me#settings are shareable
// addresses for the two halves of the page. Both panels stay mounted —
// switching tabs must not drop half-typed form state — so the inactive
// one is display-hidden rather than unmounted.
export function MeTabs({ profile }: { profile: NonNullable<Me["profile"]> }) {
  const [tab, setTab] = useState<TabId>("profile");

  // The hash is the source of truth, read after mount (the server can't
  // see it) and on every hashchange so browser back/forward switches
  // tabs too.
  useEffect(() => {
    const sync = () => setTab(window.location.hash === "#settings" ? "settings" : "profile");
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);

  return (
    <>
      <TabBar ariaLabel="Profile and settings">
        <Tab href="#profile" active={tab === "profile"}>
          Profile
        </Tab>
        <Tab href="#settings" active={tab === "settings"}>
          Settings
        </Tab>
      </TabBar>

      <section
        aria-label="Profile"
        className={cn("w-full max-w-md flex-col items-center gap-6", tab === "profile" ? "flex" : "hidden")}
      >
        <Link
          href={`/members/${profile.slug ?? profile.id}`}
          className="self-end text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          View your profile as others see it →
        </Link>

        <AvatarUploader name={profile.displayName} initialUrl={profile.avatarUrl} />

        <ProfileForm
          initial={{
            displayName: profile.displayName ?? "",
            bio: profile.bio ?? "",
            keywords: profile.keywords ?? [],
            location: profile.location ?? "",
            supplementaryInfo: profile.supplementaryInfo ?? "",
            currentIntention: profile.currentIntention ?? "",
          }}
        />
      </section>

      <section
        aria-label="Settings"
        className={cn("w-full max-w-md flex-col gap-6", tab === "settings" ? "flex" : "hidden")}
      >
        <SettingsSections profile={profile} />
      </section>
    </>
  );
}
