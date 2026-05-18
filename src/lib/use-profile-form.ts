"use client";

import { useState } from "react";

import { apiClient } from "@/lib/api";

export type ProfileFormValues = {
  displayName: string;
  bio: string;
  keywords: string[];
  location: string;
  supplementaryInfo: string;
  emergencyContact: string;
  liveDesire: string;
};

export type ProfileFormStatus =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "success" }
  | { kind: "error"; message: string };

export function useProfileForm(initial: ProfileFormValues) {
  const [displayName, setDisplayName] = useState(initial.displayName);
  const [bio, setBio] = useState(initial.bio);
  const [keywordsText, setKeywordsText] = useState(initial.keywords.join(", "));
  const [location, setLocation] = useState(initial.location);
  const [supplementaryInfo, setSupplementaryInfo] = useState(initial.supplementaryInfo);
  const [emergencyContact, setEmergencyContact] = useState(initial.emergencyContact);
  const [liveDesire, setLiveDesire] = useState(initial.liveDesire);
  const [status, setStatus] = useState<ProfileFormStatus>({ kind: "idle" });

  const submit = async (): Promise<boolean> => {
    setStatus({ kind: "submitting" });
    try {
      const keywords = keywordsText
        .split(",")
        .map((k) => k.trim())
        .filter(Boolean);

      const res = await apiClient.api.me.$put({
        json: {
          displayName: displayName.trim() || null,
          bio: bio.trim() || null,
          keywords,
          location: location.trim() || null,
          supplementaryInfo: supplementaryInfo.trim() || null,
          emergencyContact: emergencyContact.trim() || null,
          liveDesire: liveDesire.trim() || null,
        },
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setStatus({ kind: "error", message: body.error ?? "Failed to save profile." });
        return false;
      }

      setStatus({ kind: "success" });
      return true;
    } catch (err) {
      setStatus({
        kind: "error",
        message: err instanceof Error ? err.message : "Unexpected error while saving.",
      });
      return false;
    }
  };

  return {
    fields: { displayName, bio, keywordsText, location, supplementaryInfo, emergencyContact, liveDesire },
    setters: { setDisplayName, setBio, setKeywordsText, setLocation, setSupplementaryInfo, setEmergencyContact, setLiveDesire },
    status,
    setStatus,
    submit,
    disabled: status.kind === "submitting",
  };
}
