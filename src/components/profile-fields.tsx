"use client";

import { MarkdownEditor } from "@/components/markdown-editor";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Props = {
  fields: {
    displayName: string;
    bio: string;
    keywordsText: string;
    location: string;
    currentIntention: string;
    supplementaryInfo: string;
  };
  setters: {
    setDisplayName: (v: string) => void;
    setBio: (v: string) => void;
    setKeywordsText: (v: string) => void;
    setLocation: (v: string) => void;
    setCurrentIntention: (v: string) => void;
    setSupplementaryInfo: (v: string) => void;
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

      {/* Editor renders a contenteditable div (no labelable control), so the
          field name rides on the editor's ariaLabel rather than htmlFor. Bio is
          required; the empty check lives in useProfileForm (rendered output,
          not raw string length). */}
      <Label>Bio</Label>
      <MarkdownEditor ariaLabel="Bio" value={fields.bio} onChange={setters.setBio} disabled={disabled} />

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

      <Label>
        Current intention <span className="text-muted-foreground">(what are you focused on right now?)</span>
      </Label>
      <MarkdownEditor
        ariaLabel="Current intention"
        value={fields.currentIntention}
        onChange={setters.setCurrentIntention}
        disabled={disabled}
        placeholder="e.g. Building deeper listening skills in my conversations this quarter."
      />

      <Label>Supplementary info</Label>
      <MarkdownEditor
        ariaLabel="Supplementary info"
        value={fields.supplementaryInfo}
        onChange={setters.setSupplementaryInfo}
        disabled={disabled}
      />
    </>
  );
}
