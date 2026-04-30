"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { apiClient } from "@/lib/api";

type ProfileFormProps = {
  initial: {
    displayName: string;
    bio: string;
    keywords: string[];
    location: string;
    supplementaryInfo: string;
    avatarUrl: string;
    emergencyContact: string;
    liveDesire: string;
  };
};

type Status =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "success" }
  | { kind: "error"; message: string };

export function ProfileForm({ initial }: ProfileFormProps) {
  const router = useRouter();
  const [displayName, setDisplayName] = useState(initial.displayName);
  const [bio, setBio] = useState(initial.bio);
  const [keywordsText, setKeywordsText] = useState(initial.keywords.join(", "));
  const [location, setLocation] = useState(initial.location);
  const [supplementaryInfo, setSupplementaryInfo] = useState(initial.supplementaryInfo);
  const [avatarUrl, setAvatarUrl] = useState(initial.avatarUrl);
  const [emergencyContact, setEmergencyContact] = useState(initial.emergencyContact);
  const [liveDesire, setLiveDesire] = useState(initial.liveDesire);
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
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
          avatarUrl: avatarUrl.trim() || null,
          emergencyContact: emergencyContact.trim() || null,
          liveDesire: liveDesire.trim() || null,
        },
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setStatus({ kind: "error", message: body.error ?? "Failed to save profile." });
        return;
      }

      setStatus({ kind: "success" });
      router.push("/profile");
      router.refresh();
    } catch (err) {
      setStatus({
        kind: "error",
        message: err instanceof Error ? err.message : "Unexpected error while saving.",
      });
    }
  };

  const disabled = status.kind === "submitting";

  return (
    <form onSubmit={handleSubmit} className="flex w-full max-w-md flex-col gap-3">
      <label className="text-sm text-gray-300" htmlFor="displayName">
        Display name
      </label>
      <input
        id="displayName"
        type="text"
        required
        value={displayName}
        onChange={(e) => setDisplayName(e.target.value)}
        disabled={disabled}
        className="rounded border border-gray-600 bg-transparent px-3 py-2 text-sm focus:border-gray-300 focus:outline-none"
      />

      <label className="text-sm text-gray-300" htmlFor="bio">
        Bio
      </label>
      <textarea
        id="bio"
        required
        value={bio}
        onChange={(e) => setBio(e.target.value)}
        disabled={disabled}
        rows={4}
        className="rounded border border-gray-600 bg-transparent px-3 py-2 text-sm focus:border-gray-300 focus:outline-none"
      />

      <label className="text-sm text-gray-300" htmlFor="keywords">
        Keywords <span className="text-gray-500">(comma-separated)</span>
      </label>
      <input
        id="keywords"
        type="text"
        value={keywordsText}
        onChange={(e) => setKeywordsText(e.target.value)}
        disabled={disabled}
        className="rounded border border-gray-600 bg-transparent px-3 py-2 text-sm focus:border-gray-300 focus:outline-none"
      />

      <label className="text-sm text-gray-300" htmlFor="location">
        Location
      </label>
      <input
        id="location"
        type="text"
        value={location}
        onChange={(e) => setLocation(e.target.value)}
        disabled={disabled}
        className="rounded border border-gray-600 bg-transparent px-3 py-2 text-sm focus:border-gray-300 focus:outline-none"
      />

      <label className="text-sm text-gray-300" htmlFor="liveDesire">
        Live desire
      </label>
      <textarea
        id="liveDesire"
        value={liveDesire}
        onChange={(e) => setLiveDesire(e.target.value)}
        disabled={disabled}
        rows={3}
        className="rounded border border-gray-600 bg-transparent px-3 py-2 text-sm focus:border-gray-300 focus:outline-none"
      />

      <label className="text-sm text-gray-300" htmlFor="supplementaryInfo">
        Supplementary info
      </label>
      <textarea
        id="supplementaryInfo"
        value={supplementaryInfo}
        onChange={(e) => setSupplementaryInfo(e.target.value)}
        disabled={disabled}
        rows={3}
        className="rounded border border-gray-600 bg-transparent px-3 py-2 text-sm focus:border-gray-300 focus:outline-none"
      />

      <label className="text-sm text-gray-300" htmlFor="avatarUrl">
        Avatar URL
      </label>
      <input
        id="avatarUrl"
        type="url"
        value={avatarUrl}
        onChange={(e) => setAvatarUrl(e.target.value)}
        disabled={disabled}
        className="rounded border border-gray-600 bg-transparent px-3 py-2 text-sm focus:border-gray-300 focus:outline-none"
      />

      <label className="text-sm text-gray-300" htmlFor="emergencyContact">
        Emergency contact
      </label>
      <input
        id="emergencyContact"
        type="text"
        value={emergencyContact}
        onChange={(e) => setEmergencyContact(e.target.value)}
        disabled={disabled}
        className="rounded border border-gray-600 bg-transparent px-3 py-2 text-sm focus:border-gray-300 focus:outline-none"
      />
      <p className="text-xs text-gray-500">
        Visible only to you and admins in case of emergency.
      </p>

      <button
        type="submit"
        disabled={disabled}
        className="mt-3 rounded bg-gray-100 px-3 py-2 text-sm font-medium text-gray-900 disabled:opacity-50"
      >
        {disabled ? "Saving…" : "Save changes"}
      </button>

      {status.kind === "success" && (
        <p role="status" className="text-sm text-green-400">
          Profile saved.
        </p>
      )}
      {status.kind === "error" && (
        <p role="alert" className="text-sm text-red-300">
          {status.message}
        </p>
      )}
    </form>
  );
}
