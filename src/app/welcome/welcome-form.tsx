"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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

type Status = { kind: "idle" } | { kind: "submitting" } | { kind: "error"; message: string };

export function WelcomeForm({ initial }: { initial: Initial }) {
  const router = useRouter();
  const [displayName, setDisplayName] = useState(initial.displayName);
  const [bio, setBio] = useState(initial.bio);
  const [keywordsText, setKeywordsText] = useState(initial.keywords.join(", "));
  const [location, setLocation] = useState(initial.location);
  const [supplementaryInfo, setSupplementaryInfo] = useState(initial.supplementaryInfo);
  const [avatarUrl, setAvatarUrl] = useState(initial.avatarUrl);
  const [emergencyContact, setEmergencyContact] = useState(initial.emergencyContact);
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
        message: err instanceof Error ? err.message : "Unexpected error while saving.",
      });
    }
  };

  const disabled = status.kind === "submitting";

  return (
    <form onSubmit={handleSubmit} className="flex w-full max-w-md flex-col gap-3">
      <Label htmlFor="displayName">Display name</Label>
      <Input
        id="displayName"
        type="text"
        required
        value={displayName}
        onChange={(e) => setDisplayName(e.target.value)}
        disabled={disabled}
      />

      <Label htmlFor="bio">Bio</Label>
      <Textarea id="bio" required value={bio} onChange={(e) => setBio(e.target.value)} disabled={disabled} rows={4} />

      <Label htmlFor="keywords">Keywords (comma-separated)</Label>
      <Input
        id="keywords"
        type="text"
        value={keywordsText}
        onChange={(e) => setKeywordsText(e.target.value)}
        disabled={disabled}
      />

      <Label htmlFor="location">Location</Label>
      <Input
        id="location"
        type="text"
        value={location}
        onChange={(e) => setLocation(e.target.value)}
        disabled={disabled}
      />

      <Label htmlFor="liveDesire">Live desire</Label>
      <Textarea
        id="liveDesire"
        value={liveDesire}
        onChange={(e) => setLiveDesire(e.target.value)}
        disabled={disabled}
        rows={3}
      />

      <Label htmlFor="supplementaryInfo">Supplementary info</Label>
      <Textarea
        id="supplementaryInfo"
        value={supplementaryInfo}
        onChange={(e) => setSupplementaryInfo(e.target.value)}
        disabled={disabled}
        rows={3}
      />

      <Label htmlFor="avatarUrl">Avatar URL</Label>
      <Input
        id="avatarUrl"
        type="url"
        value={avatarUrl}
        onChange={(e) => setAvatarUrl(e.target.value)}
        disabled={disabled}
      />

      <Label htmlFor="emergencyContact">Emergency contact</Label>
      <Input
        id="emergencyContact"
        type="text"
        value={emergencyContact}
        onChange={(e) => setEmergencyContact(e.target.value)}
        disabled={disabled}
      />
      <p className="text-sm text-muted-foreground">Visible only to you (and admins in case of emergency).</p>

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
