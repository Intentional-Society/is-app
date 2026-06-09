"use client";

import { useRouter } from "next/navigation";

import { ProfileFields } from "@/components/profile-fields";
import { Button } from "@/components/ui/button";
import { type ProfileFormValues, useProfileForm } from "@/lib/use-profile-form";

export function ProfileForm({ initial }: { initial: ProfileFormValues }) {
  const router = useRouter();
  const { fields, setters, status, submit, disabled } = useProfileForm(initial);

  const handleSubmit = async (e: React.SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();
    const ok = await submit();
    // Stay on /me — the inline "Profile saved." status is the feedback,
    // and refresh() re-renders the server page so the public-profile
    // link picks up a freshly backfilled slug.
    if (ok) router.refresh();
  };

  return (
    <form onSubmit={handleSubmit} className="flex w-full max-w-md flex-col gap-3">
      <ProfileFields fields={fields} setters={setters} disabled={disabled} />

      <Button type="submit" className="mt-3" disabled={disabled}>
        {disabled ? "Saving…" : "Save changes"}
      </Button>

      {status.kind === "success" && (
        <p role="status" className="text-base text-success">
          Profile saved.
        </p>
      )}
      {status.kind === "error" && (
        <p role="alert" className="text-base text-destructive">
          {status.message}
        </p>
      )}
    </form>
  );
}
