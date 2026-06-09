"use client";

import { useRouter } from "next/navigation";

import { ProfileFields } from "@/components/profile-fields";
import { Button } from "@/components/ui/button";
import { type ProfileFormValues, useProfileForm } from "@/lib/use-profile-form";

// The password field that used to live here moved to the Settings tab
// (ChangePasswordForm), which this step reveals after a save.
export function WelcomeForm({ initial, onSaved }: { initial: ProfileFormValues; onSaved: () => void }) {
  const router = useRouter();
  const { fields, setters, status, submit, disabled } = useProfileForm(initial);

  const handleSubmit = async (e: React.SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();
    const ok = await submit();
    if (!ok) return;

    // Stay on the step: the parent reveals the settings tour and the
    // Continue button. refresh() re-renders the server page so the
    // settings tab sees the freshly backfilled slug.
    router.refresh();
    onSaved();
  };

  return (
    <form onSubmit={handleSubmit} className="flex w-full max-w-md flex-col gap-3">
      <ProfileFields fields={fields} setters={setters} disabled={disabled} />

      <Button type="submit" className="mt-3" disabled={disabled}>
        {disabled ? "Saving…" : "Save"}
      </Button>

      {/* No success line: the settings tour's "Profile saved!" title is
          the confirmation — its overlay would hide a message here anyway. */}
      {status.kind === "error" && (
        <p role="alert" className="text-base text-destructive">
          {status.message}
        </p>
      )}
    </form>
  );
}
