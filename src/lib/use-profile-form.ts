"use client";

import { useState } from "react";

import { apiClient } from "@/lib/api";
import { markdownHasContent } from "@/lib/markdown";

export type ProfileFormValues = {
  displayName: string;
  bio: string;
  keywords: string[];
  location: string;
  supplementaryInfo: string;
  currentIntention: string;
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
  const [currentIntention, setCurrentIntention] = useState(initial.currentIntention);
  const [status, setStatus] = useState<ProfileFormStatus>({ kind: "idle" });

  const submit = async (): Promise<boolean> => {
    // Bio is the one required prose field. The editor is a WYSIWYG surface with
    // no native `required`, and a cleared editor can still hold whitespace or
    // empty markup — so gate on the rendered output, not the raw string length.
    if (!markdownHasContent(bio)) {
      setStatus({ kind: "error", message: "Bio is required." });
      return false;
    }
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
          currentIntention: currentIntention.trim() || null,
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
    fields: { displayName, bio, keywordsText, location, supplementaryInfo, currentIntention },
    setters: {
      setDisplayName,
      setBio,
      setKeywordsText,
      setLocation,
      setSupplementaryInfo,
      setCurrentIntention,
    },
    status,
    setStatus,
    submit,
    disabled: status.kind === "submitting",
  };
}
