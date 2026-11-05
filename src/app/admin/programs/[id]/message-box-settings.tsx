"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { messageBoxQueryKey } from "@/app/programs/[slug]/query-keys";
import { MarkdownEditor } from "@/components/markdown-editor";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { apiClient } from "@/lib/api";
import {
  MESSAGE_BOX_MAX_PROMPT_LENGTH,
  MESSAGE_BOX_VISIBILITIES,
  type MessageBoxVisibility,
} from "@/lib/program-features";

const settingsQueryKey = (programId: string) => ["admin", "programs", programId, "message-box-settings"] as const;

const VISIBILITY_LABELS: Record<MessageBoxVisibility, { label: string; hint: string }> = {
  admins: { label: "Admins only", hint: "Only admins can read the messages." },
  members: { label: "All members", hint: "Any signed-in member can read the messages." },
};

type Settings = { visibility: MessageBoxVisibility; prompt: string | null };

const fetchSettings = async (programId: string): Promise<Settings> => {
  const res = await apiClient.api.admin.programs[":id"]["message-box"].$get({ param: { id: programId } });
  if (!res.ok) throw new Error(`admin/programs/${programId}/message-box: ${res.status}`);
  return res.json();
};

// Admin settings for the message-box feature: who can read, and the prompt.
// Rendered by the Features panel under the feature's toggle.
export function MessageBoxSettings({ programId }: { programId: string }) {
  const query = useQuery({
    queryKey: settingsQueryKey(programId),
    queryFn: () => fetchSettings(programId),
  });

  // The editor seeds from the loaded prompt once; remounting on a new key
  // would drop in-progress edits, so it waits for the load instead.
  if (query.isPending) return <p className="text-sm text-muted-foreground">Loading settings…</p>;
  if (query.isError) {
    return (
      <p role="alert" className="text-sm text-destructive">
        Couldn't load the message box settings.
      </p>
    );
  }
  return <MessageBoxSettingsForm programId={programId} settings={query.data} />;
}

function MessageBoxSettingsForm({ programId, settings }: { programId: string; settings: Settings }) {
  const queryClient = useQueryClient();
  const [prompt, setPrompt] = useState(settings.prompt ?? "");

  const saveMutation = useMutation({
    mutationFn: async (update: { visibility?: MessageBoxVisibility; prompt?: string | null }) => {
      const res = await apiClient.api.admin.programs[":id"]["message-box"].$patch({
        param: { id: programId },
        json: update,
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Failed to save the message box settings.");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: settingsQueryKey(programId) });
      queryClient.invalidateQueries({ queryKey: messageBoxQueryKey(programId) });
    },
  });

  // Show the pending choice right away instead of waiting for the refetch.
  const shownVisibility =
    saveMutation.isPending && saveMutation.variables?.visibility
      ? saveMutation.variables.visibility
      : settings.visibility;
  const promptDirty = prompt.trim() !== (settings.prompt ?? "");

  return (
    <div className="flex flex-col gap-3">
      <fieldset className="flex flex-col gap-1.5 rounded border border-border p-2">
        <legend className="px-1 text-xs font-medium text-muted-foreground">Who can read messages</legend>
        {MESSAGE_BOX_VISIBILITIES.map((value) => (
          <label key={value} className="flex items-start gap-2">
            <input
              type="radio"
              name={`message-box-visibility-${programId}`}
              value={value}
              checked={shownVisibility === value}
              disabled={saveMutation.isPending}
              onChange={() => saveMutation.mutate({ visibility: value })}
              className="mt-1"
            />
            <span>
              <span className="font-medium">{VISIBILITY_LABELS[value].label}</span>{" "}
              <span className="text-muted-foreground">— {VISIBILITY_LABELS[value].hint}</span>
            </span>
          </label>
        ))}
        <p className="text-xs text-muted-foreground">
          Admins can always read and delete messages. Posting is for participants.
        </p>
      </fieldset>

      <div className="flex flex-col gap-1.5">
        {/* The editor renders a contenteditable div (no labelable control), so the
            field name rides on the editor's ariaLabel rather than htmlFor. */}
        <Label>Prompt</Label>
        <MarkdownEditor
          variant="full"
          ariaLabel="Message box prompt"
          value={prompt}
          onChange={setPrompt}
          disabled={saveMutation.isPending}
          placeholder="e.g. Won't be there at the next call? Send a short message of connection."
        />
        <p className="text-xs text-muted-foreground">
          Shown above the message box on the program page. Leave blank for none. Max {MESSAGE_BOX_MAX_PROMPT_LENGTH}{" "}
          characters.
        </p>
        <Button
          type="button"
          variant="secondary"
          size="xs"
          className="self-start"
          disabled={saveMutation.isPending || !promptDirty}
          onClick={() => saveMutation.mutate({ prompt: prompt.trim() || null })}
        >
          {saveMutation.isPending && saveMutation.variables?.prompt !== undefined ? "Saving…" : "Save prompt"}
        </Button>
      </div>

      {saveMutation.isError && (
        <p role="alert" className="text-sm text-destructive">
          {saveMutation.error.message}
        </p>
      )}
    </div>
  );
}
