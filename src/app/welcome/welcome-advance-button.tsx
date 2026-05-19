"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { apiClient } from "@/lib/api";

// The agreements and programs steps each end with one of these. It
// stamps the step's marker via the API, then returns to the /welcome
// index, which recomputes and routes on to the next unfinished step (or
// /myweb when onboarding is complete). The profile step doesn't use this
// — its form already stamps lastUpdatedProfile via PUT /me.
const STAMP = {
  agreements: () => apiClient.api.me["last-signed-agreements"].$put(),
  programs: () => apiClient.api.me["last-reviewed-programs"].$put(),
};

export function WelcomeAdvanceButton({ step, label }: { step: keyof typeof STAMP; label: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  const advance = async () => {
    setPending(true);
    setFailed(false);
    try {
      const res = await STAMP[step]();
      if (!res.ok) throw new Error(`welcome/${step}: ${res.status}`);
      router.push("/welcome");
      router.refresh();
    } catch {
      // Stay on the step so the member can retry.
      setFailed(true);
      setPending(false);
    }
  };

  return (
    <div className="flex flex-col items-center gap-2">
      <Button type="button" onClick={advance} disabled={pending}>
        {pending ? "Saving…" : label}
      </Button>
      {failed && (
        <p role="alert" className="text-base text-destructive">
          Couldn&apos;t save — please try again.
        </p>
      )}
    </div>
  );
}
