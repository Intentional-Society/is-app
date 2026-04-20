"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { apiClient } from "@/lib/api";
import { createClient } from "@/lib/supabase/client";

type Initial = {
  displayName: string;
  bio: string;
  keywords: string[];
  location: string;
  supplementaryInfo: string;
  avatarUrl: string;
  emergencyContact: string;
  liveDesire: string;
};

type Status =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "error"; message: string };

export function WelcomeForm({ initial }: { initial: Initial }) {
  const router = useRouter();
  const [displayName, setDisplayName] = useState(initial.displayName);
  const [bio, setBio] = useState(initial.bio);
  const [keywordsText, setKeywordsText] = useState(initial.keywords.join(", "));
  const [location, setLocation] = useState(initial.location);
  const [supplementaryInfo, setSupplementaryInfo] = useState(
    initial.supplementaryInfo,
  );
  const [avatarUrl, setAvatarUrl] = useState(initial.avatarUrl);
  const [emergencyContact, setEmergencyContact] = useState(
    initial.emergencyContact,
  );
  const [liveDesire, setLiveDesire] = useState(initial.liveDesire);
  const [password, setPassword] = useState("");
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
        setStatus({
          kind: "error",
          message: body.error ?? "Failed to save profile.",
        });
        return;
      }

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

      router.push("/");
      router.refresh();
    } catch (err) {
      // Unexpected throws (network drop, CORS, a thrown Supabase client
      // bug) must not leave the button stuck on "Saving…" with no UI
      // feedback. Surface the message and release the form.
      setStatus({
        kind: "error",
        message:
          err instanceof Error ? err.message : "Unexpected error while saving.",
      });
    }
  };

  const disabled = status.kind === "submitting";

  return (
    <form
      onSubmit={handleSubmit}
      className="flex w-full max-w-md flex-col gap-3"
    >
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
        className="rounded border border-gray-600 bg-transparent px-3 py-2 text-sm text-gray-900 focus:border-gray-300 focus:outline-none"
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
        className="rounded border border-gray-600 bg-transparent px-3 py-2 text-sm text-gray-900 focus:border-gray-300 focus:outline-none"
      />

      <label className="text-sm text-gray-300" htmlFor="keywords">
        Keywords (comma-separated)
      </label>
      <input
        id="keywords"
        type="text"
        value={keywordsText}
        onChange={(e) => setKeywordsText(e.target.value)}
        disabled={disabled}
        className="rounded border border-gray-600 bg-transparent px-3 py-2 text-sm text-gray-900 focus:border-gray-300 focus:outline-none"
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
        className="rounded border border-gray-600 bg-transparent px-3 py-2 text-sm text-gray-900 focus:border-gray-300 focus:outline-none"
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
        className="rounded border border-gray-600 bg-transparent px-3 py-2 text-sm text-gray-900 focus:border-gray-300 focus:outline-none"
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
        className="rounded border border-gray-600 bg-transparent px-3 py-2 text-sm text-gray-900 focus:border-gray-300 focus:outline-none"
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
        className="rounded border border-gray-600 bg-transparent px-3 py-2 text-sm text-gray-900 focus:border-gray-300 focus:outline-none"
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
        className="rounded border border-gray-600 bg-transparent px-3 py-2 text-sm text-gray-900 focus:border-gray-300 focus:outline-none"
      />
      <p className="text-xs text-gray-500">
        Visible only to you (and admins in case of emergency).
      </p>

      <hr className="my-3 border-gray-700" />

      <label className="text-sm text-gray-300" htmlFor="password">
        Set a password (optional)
      </label>
      <input
        id="password"
        type="password"
        autoComplete="new-password"
        placeholder="Leave blank to continue using magic links"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        disabled={disabled}
        className="rounded border border-gray-600 bg-transparent px-3 py-2 text-sm text-gray-900 focus:border-gray-300 focus:outline-none"
      />
      <p className="text-xs text-gray-500">
        You can always sign in with a magic link instead.
      </p>

      <button
        type="submit"
        disabled={disabled}
        className="mt-3 rounded bg-gray-100 px-3 py-2 text-sm font-medium text-gray-900 disabled:opacity-50"
      >
        {disabled ? "Saving…" : "Save"}
      </button>

      {status.kind === "error" && (
        <p role="alert" className="text-sm text-red-300">
          {status.message}
        </p>
      )}
    </form>
  );
}
