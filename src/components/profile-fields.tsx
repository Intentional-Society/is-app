"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type Props = {
  fields: {
    displayName: string;
    bio: string;
    keywordsText: string;
    location: string;
    currentIntention: string;
    supplementaryInfo: string;
    emergencyContact: string;
  };
  setters: {
    setDisplayName: (v: string) => void;
    setBio: (v: string) => void;
    setKeywordsText: (v: string) => void;
    setLocation: (v: string) => void;
    setCurrentIntention: (v: string) => void;
    setSupplementaryInfo: (v: string) => void;
    setEmergencyContact: (v: string) => void;
  };
  disabled: boolean;
};

export function ProfileFields({ fields, setters, disabled }: Props) {
  return (
    <>
      <Label htmlFor="displayName">Display name</Label>
      <Input
        id="displayName"
        type="text"
        required
        value={fields.displayName}
        onChange={(e) => setters.setDisplayName(e.target.value)}
        disabled={disabled}
      />

      <Label htmlFor="bio">Bio</Label>
      <Textarea
        id="bio"
        required
        value={fields.bio}
        onChange={(e) => setters.setBio(e.target.value)}
        disabled={disabled}
        rows={4}
      />

      <Label htmlFor="keywords">
        Keywords <span className="text-muted-foreground">(comma-separated)</span>
      </Label>
      <Input
        id="keywords"
        type="text"
        value={fields.keywordsText}
        onChange={(e) => setters.setKeywordsText(e.target.value)}
        disabled={disabled}
      />

      <Label htmlFor="location">Location</Label>
      <Input
        id="location"
        type="text"
        value={fields.location}
        onChange={(e) => setters.setLocation(e.target.value)}
        disabled={disabled}
      />

      <Label htmlFor="currentIntention">
        Current intention <span className="text-muted-foreground">(what are you focused on right now?)</span>
      </Label>
      <Textarea
        id="currentIntention"
        value={fields.currentIntention}
        onChange={(e) => setters.setCurrentIntention(e.target.value)}
        disabled={disabled}
        rows={3}
        placeholder="e.g. Building deeper listening skills in my conversations this quarter."
      />

      <Label htmlFor="supplementaryInfo">Supplementary info</Label>
      <Textarea
        id="supplementaryInfo"
        value={fields.supplementaryInfo}
        onChange={(e) => setters.setSupplementaryInfo(e.target.value)}
        disabled={disabled}
        rows={3}
      />

      <Label htmlFor="emergencyContact">Emergency contact</Label>
      <p id="emergencyContact-description" className="text-sm text-muted-foreground">
        Visible only to you and admins in case of emergency.
      </p>
      <Textarea
        id="emergencyContact"
        aria-describedby="emergencyContact-description"
        value={fields.emergencyContact}
        onChange={(e) => setters.setEmergencyContact(e.target.value)}
        disabled={disabled}
        rows={3}
      />
    </>
  );
}
