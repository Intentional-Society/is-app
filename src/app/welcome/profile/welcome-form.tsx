"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { ProfileFields } from "@/components/profile-fields";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";
import { type ProfileFormValues, useProfileForm } from "@/lib/use-profile-form";

export function WelcomeForm({ initial }: { initial: ProfileFormValues }) {
  const router = useRouter();
  const { fields, setters, status, setStatus, submit, disabled } = useProfileForm(initial);
  const [password, setPassword] = useState("");

  const handleSubmit = async (e: React.SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();
    const ok = await submit();
    if (!ok) return;

    if (password.length > 0) {
      const supabase = createClient();
      const { error } = await supabase.auth.updateUser({ password });
      if (error) {
        setStatus({
          kind: "error",
          message: `Profile saved, but password update failed: ${error.message}`,
        });
        return;
      }
    }

    // Back to the /welcome index, which routes on to the next step.
    router.push("/welcome");
    router.refresh();
  };

  return (
    <form onSubmit={handleSubmit} className="flex w-full max-w-md flex-col gap-3">
      <ProfileFields fields={fields} setters={setters} disabled={disabled} />

      <hr className="my-3 border-border" />

      <Label htmlFor="password">Set a password (optional)</Label>
      <Input
        id="password"
        type="password"
        autoComplete="new-password"
        placeholder="Leave blank to continue using magic links"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        disabled={disabled}
      />
      <p className="text-sm text-muted-foreground">You can always sign in with a magic link instead.</p>

      <Button type="submit" className="mt-3" disabled={disabled}>
        {disabled ? "Saving…" : "Save"}
      </Button>

      {status.kind === "error" && (
        <p role="alert" className="text-base text-destructive">
          {status.message}
        </p>
      )}
    </form>
  );
}
