"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { AvatarUploader } from "@/components/avatar-uploader";
import type { Me } from "@/lib/api-types";
import { cn } from "@/lib/utils";

import { ChangePasswordForm } from "./change-password-form";
import { DeactivateAccountForm } from "./deactivate-account-form";
import { EmergencyContactForm } from "./emergency-contact-form";
import { ProfileForm } from "./profile-form";
import { SlugForm } from "./slug-form";
import { ThemeSelector } from "./theme-selector";

type Tab = "profile" | "settings";

// Anchor-link tabs (#376): /me#profile and /me#settings are shareable
// addresses for the two halves of the page. Both panels stay mounted —
// switching tabs must not drop half-typed form state — so the inactive
// one is display-hidden rather than unmounted.
function TabLink({ tab, active, children }: { tab: Tab; active: boolean; children: React.ReactNode }) {
  return (
    <a
      role="tab"
      aria-selected={active}
      href={`#${tab}`}
      className={cn(
        "-mb-px border-b-2 px-4 py-2 text-base",
        active ? "border-primary font-semibold" : "border-transparent text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </a>
  );
}

function SettingsSection({
  title,
  description,
  children,
  divider = true,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
  divider?: boolean;
}) {
  return (
    <div className={cn("flex w-full flex-col gap-3", divider && "border-t border-border pt-6")}>
      <h2 className="text-base font-semibold">{title}</h2>
      <p className="text-sm text-muted-foreground">{description}</p>
      {children}
    </div>
  );
}

export function MeTabs({ profile }: { profile: NonNullable<Me["profile"]> }) {
  const [tab, setTab] = useState<Tab>("profile");

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
      <div role="tablist" aria-label="Profile and settings" className="flex w-full max-w-md border-b border-border">
        <TabLink tab="profile" active={tab === "profile"}>
          Profile
        </TabLink>
        <TabLink tab="settings" active={tab === "settings"}>
          Settings
        </TabLink>
      </div>

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
        <SettingsSection title="Theme" description="How the app looks on this device." divider={false}>
          <ThemeSelector />
        </SettingsSection>

        <SettingsSection
          title="Profile URL"
          description="The address of your profile in the member directory. Changing it breaks links you've already shared."
        >
          <SlugForm initialSlug={profile.slug} />
        </SettingsSection>

        <SettingsSection title="Emergency contact" description="Visible only to you and admins, in case of emergency.">
          <EmergencyContactForm initial={profile.emergencyContact ?? ""} />
        </SettingsSection>

        <SettingsSection
          title="Set or change password"
          description="If you prefer signing in via email, you don't need a password."
        >
          <ChangePasswordForm />
        </SettingsSection>

        <SettingsSection
          title="Deactivate account"
          description="Hides your profile from other members. Some records of past participation may remain visible in other people's history data."
        >
          <DeactivateAccountForm isDeactivated={!!profile.deactivatedAt} />
        </SettingsSection>
      </section>
    </>
  );
}
