"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { apiClient } from "@/lib/api";
import type { AdminProgramFeature } from "@/lib/api-types";
import { MESSAGE_BOX_FEATURE, MESSAGE_BOX_VISIBILITIES, type MessageBoxVisibility } from "@/lib/program-features";

const featuresQueryKey = (programId: string) => ["admin", "programs", programId, "features"] as const;
const messageBoxSettingsQueryKey = (programId: string) =>
  ["admin", "programs", programId, "message-box-settings"] as const;

const VISIBILITY_LABELS: Record<MessageBoxVisibility, { label: string; hint: string }> = {
  admins: { label: "Admins only", hint: "Only admins can read the messages." },
  members: { label: "All members", hint: "Any signed-in member can read the messages." },
};

const fetchFeatures = async (programId: string): Promise<AdminProgramFeature[]> => {
  const res = await apiClient.api.admin.programs[":id"].features.$get({ param: { id: programId } });
  if (!res.ok) throw new Error(`admin/programs/${programId}/features: ${res.status}`);
  return (await res.json()).features;
};

const fetchVisibility = async (programId: string): Promise<MessageBoxVisibility> => {
  const res = await apiClient.api.admin.programs[":id"]["message-box"].$get({ param: { id: programId } });
  if (!res.ok) throw new Error(`admin/programs/${programId}/message-box: ${res.status}`);
  return (await res.json()).visibility;
};

// Admin toggles for the program features in the code registry
// (docs/design-programs.md). Features are off until attached.
export function ProgramFeaturesPanel({ programId }: { programId: string }) {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: featuresQueryKey(programId), queryFn: () => fetchFeatures(programId) });

  const toggleMutation = useMutation({
    mutationFn: async (vars: { key: string; attach: boolean }) => {
      const param = { id: programId, key: vars.key };
      const res = vars.attach
        ? await apiClient.api.admin.programs[":id"].features[":key"].$put({ param })
        : await apiClient.api.admin.programs[":id"].features[":key"].$delete({ param });
      if (!res.ok) throw new Error("Failed to update the feature.");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: featuresQueryKey(programId) });
      // Member-side caches of the program page now list a different feature set.
      queryClient.invalidateQueries({ queryKey: ["programs"] });
    },
  });

  return (
    <section className="flex flex-col gap-3 rounded border border-border p-3">
      <h2 className="text-base font-semibold uppercase tracking-wide text-muted-foreground">Features</h2>
      {query.isPending ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : query.isError ? (
        <p role="alert" className="text-sm text-destructive">
          Couldn't load features.
        </p>
      ) : (
        <ul className="flex flex-col gap-4 text-sm">
          {query.data.map((feature) => (
            <li key={feature.key} className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-3">
                <span>
                  <span className="font-medium">{feature.name}</span>{" "}
                  <span className="text-muted-foreground">— {feature.description}</span>
                </span>
                <Button
                  type="button"
                  variant="secondary"
                  size="xs"
                  disabled={toggleMutation.isPending}
                  onClick={() => toggleMutation.mutate({ key: feature.key, attach: !feature.attached })}
                >
                  {feature.attached ? "Turn off" : "Turn on"}
                </Button>
              </div>
              {feature.key === MESSAGE_BOX_FEATURE && feature.attached && <MessageBoxSettings programId={programId} />}
            </li>
          ))}
        </ul>
      )}
      {toggleMutation.isError && (
        <p role="alert" className="text-sm text-destructive">
          {toggleMutation.error.message}
        </p>
      )}
    </section>
  );
}

function MessageBoxSettings({ programId }: { programId: string }) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: messageBoxSettingsQueryKey(programId),
    queryFn: () => fetchVisibility(programId),
  });

  const visibilityMutation = useMutation({
    mutationFn: async (visibility: MessageBoxVisibility) => {
      const res = await apiClient.api.admin.programs[":id"]["message-box"].$patch({
        param: { id: programId },
        json: { visibility },
      });
      if (!res.ok) throw new Error("Failed to update who can read messages.");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: messageBoxSettingsQueryKey(programId) });
      queryClient.invalidateQueries({ queryKey: ["programs", programId, "message-box"] });
    },
  });

  // Show the pending choice right away instead of waiting for the refetch.
  const shown = visibilityMutation.isPending ? visibilityMutation.variables : query.data;

  return (
    <fieldset className="flex flex-col gap-1.5 rounded border border-border p-2" disabled={query.isPending}>
      <legend className="px-1 text-xs font-medium text-muted-foreground">Who can read messages</legend>
      {MESSAGE_BOX_VISIBILITIES.map((value) => (
        <label key={value} className="flex items-start gap-2">
          <input
            type="radio"
            name={`message-box-visibility-${programId}`}
            value={value}
            checked={shown === value}
            disabled={visibilityMutation.isPending}
            onChange={() => visibilityMutation.mutate(value)}
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
      {(query.isError || visibilityMutation.isError) && (
        <p role="alert" className="text-sm text-destructive">
          {visibilityMutation.error?.message ?? "Couldn't load this setting."}
        </p>
      )}
    </fieldset>
  );
}
