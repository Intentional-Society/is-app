"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { apiClient } from "@/lib/api";
import type { AdminProgram } from "@/lib/api-types";

const PROGRAMS_QUERY_KEY = ["admin", "programs"] as const;

const fetchPrograms = async (): Promise<AdminProgram[]> => {
  const res = await apiClient.api.admin.programs.$get();
  if (!res.ok) throw new Error(`admin/programs: ${res.status}`);
  const body = await res.json();
  return body.programs;
};

export function ProgramsAdmin() {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const programsQuery = useQuery({ queryKey: PROGRAMS_QUERY_KEY, queryFn: fetchPrograms });

  const createMutation = useMutation({
    mutationFn: async (vars: { name: string; slug: string; description: string | null }) => {
      const res = await apiClient.api.admin.programs.$post({ json: vars });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(
          body.error === "slug_conflict"
            ? "A program with a similar name already exists."
            : (body.error ?? `admin/programs POST: ${res.status}`),
        );
      }
      return res.json();
    },
    onSuccess: () => {
      setName("");
      setSlug("");
      setDescription("");
      setErrorMessage(null);
      queryClient.invalidateQueries({ queryKey: PROGRAMS_QUERY_KEY });
    },
    onError: (err) => {
      setErrorMessage(err instanceof Error ? err.message : "Failed to create program.");
    },
  });

  const submit = () => {
    const trimmedName = name.trim();
    const trimmedSlug = slug.trim();
    if (!trimmedName) {
      setErrorMessage("Name is required.");
      return;
    }
    if (!trimmedSlug) {
      setErrorMessage("Slug is required.");
      return;
    }
    createMutation.mutate({
      name: trimmedName,
      slug: trimmedSlug,
      description: description.trim() || null,
    });
  };

  return (
    <div className="flex w-full max-w-xl flex-col gap-6">
      <section className="flex flex-col gap-3 rounded border border-border p-3">
        <h2 className="text-base font-semibold uppercase tracking-wide text-muted-foreground">New program</h2>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="program-name">Name</Label>
          <Input
            id="program-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Program name"
            disabled={createMutation.isPending}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="program-slug">Slug</Label>
          <Input
            id="program-slug"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            placeholder="program-slug"
            disabled={createMutation.isPending}
          />
          <p className="text-xs text-muted-foreground">Used in URLs — lowercase letters, numbers, and hyphens.</p>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="program-description">Description</Label>
          <Textarea
            id="program-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What is this program about?"
            disabled={createMutation.isPending}
          />
        </div>
        <Button
          type="button"
          variant="secondary"
          disabled={createMutation.isPending || !name.trim() || !slug.trim()}
          onClick={submit}
          className="self-start"
        >
          {createMutation.isPending ? "Creating…" : "Create program"}
        </Button>
        {errorMessage && (
          <p role="alert" className="text-sm text-destructive">
            {errorMessage}
          </p>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-base font-semibold uppercase tracking-wide text-muted-foreground">All programs</h2>
        {programsQuery.isPending ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : programsQuery.isError ? (
          <p role="alert" className="text-sm text-destructive">
            Couldn't load programs.
          </p>
        ) : programsQuery.data.length === 0 ? (
          <p className="text-sm text-muted-foreground">No programs yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {programsQuery.data.map((p) => (
              <li key={p.id}>
                <Link
                  href={`/admin/programs/${p.id}`}
                  className="flex items-center gap-3 rounded border border-border p-3 hover:bg-muted/50"
                >
                  <span className="flex flex-col">
                    <span className="flex items-center gap-2 text-sm font-semibold">
                      {p.name}
                      {p.archivedAt && (
                        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                          Archived
                        </span>
                      )}
                      {!p.archivedAt && !p.signupsOpen && (
                        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                          Signups closed
                        </span>
                      )}
                      {p.buttondownTag && (
                        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                          Buttondown:Linked
                        </span>
                      )}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {p.memberCount} {p.memberCount === 1 ? "participant" : "participants"}
                    </span>
                  </span>
                  <span aria-hidden="true" className="ml-auto text-muted-foreground">
                    →
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
