"use client";

import { cn } from "@/lib/utils";

import { ChangePasswordForm } from "./change-password-form";
import { DeactivateAccountForm } from "./deactivate-account-form";
import { EmergencyContactForm } from "./emergency-contact-form";
import { SlugForm } from "./slug-form";
import { ThemeSelector } from "./theme-selector";

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

// The Settings tab body, shared by /me and the welcome profile step.
// includeDeactivate=false is the welcome variant — "Deactivate account"
// is the wrong thing to show someone who just joined.
export function SettingsSections({
  profile,
  includeDeactivate = true,
}: {
  profile: { slug: string | null; emergencyContact: string | null; deactivatedAt: string | null };
  includeDeactivate?: boolean;
}) {
  return (
    <>
      <SettingsSection
        title="Set or change password"
        description="If you prefer signing in via email, you don't need a password."
        divider={false}
      >
        <ChangePasswordForm />
      </SettingsSection>

      <SettingsSection title="Emergency contact" description="Visible only to you and admins, in case of emergency.">
        <EmergencyContactForm initial={profile.emergencyContact ?? ""} />
      </SettingsSection>

      <SettingsSection
        title="Profile URL"
        description="The address of your profile in the member directory. Changing it breaks links you've already shared."
      >
        {/* The form adopts an externally changed slug (e.g. the welcome
            backfill) itself, via an effect — see slug-form.tsx. */}
        <SlugForm initialSlug={profile.slug} />
      </SettingsSection>

      <SettingsSection title="Theme" description="How the app looks on this device.">
        <ThemeSelector />
      </SettingsSection>

      {includeDeactivate && (
        <SettingsSection
          title="Deactivate account"
          description="Hides your profile from other members. Some records of past participation may remain visible in other people's history data."
        >
          <DeactivateAccountForm isDeactivated={!!profile.deactivatedAt} />
        </SettingsSection>
      )}
    </>
  );
}
