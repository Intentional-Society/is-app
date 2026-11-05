"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ComponentType } from "react";

import { Button } from "@/components/ui/button";
import { apiClient } from "@/lib/api";
import type { AdminProgramFeature } from "@/lib/api-types";
import { MESSAGE_BOX_FEATURE } from "@/lib/program-features";

import { MessageBoxSettings } from "./message-box-settings";

const featuresQueryKey = (programId: string) => ["admin", "programs", programId, "features"] as const;

const fetchFeatures = async (programId: string): Promise<AdminProgramFeature[]> => {
  const res = await apiClient.api.admin.programs[":id"].features.$get({ param: { id: programId } });
  if (!res.ok) throw new Error(`admin/programs/${programId}/features: ${res.status}`);
  return (await res.json()).features;
};

// Per-feature settings shown under a feature's toggle once it is attached.
// A feature with no settings has no entry.
const FEATURE_SETTINGS: Record<string, ComponentType<{ programId: string }>> = {
  [MESSAGE_BOX_FEATURE]: MessageBoxSettings,
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
          {query.data.map((feature) => {
            const Settings = FEATURE_SETTINGS[feature.key];
            return (
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
                {Settings && feature.attached && <Settings programId={programId} />}
              </li>
            );
          })}
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
