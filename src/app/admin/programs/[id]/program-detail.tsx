"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Avatar } from "@/components/avatar";
import { MarkdownEditor } from "@/components/markdown-editor";
import { MemberTypeahead } from "@/components/member-typeahead";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiClient } from "@/lib/api";
import type { AdminProgramDetail } from "@/lib/api-types";
import { formatDate } from "@/lib/format-date";

import { ProgramEmailsPanel } from "./program-emails-panel";

const programQueryKey = (id: string) => ["admin", "programs", id] as const;

const fetchProgram = async (id: string): Promise<AdminProgramDetail> => {
  const res = await apiClient.api.admin.programs[":id"].$get({ param: { id } });
  // Distinct sentinel so the caller can tell "missing" from "broke".
  if (res.status === 404) throw new Error("not_found");
  if (!res.ok) throw new Error(`admin/programs/${id}: ${res.status}`);
  const body = await res.json();
  return body.program;
};

export function ProgramDetail({ programId }: { programId: string }) {
  const query = useQuery({
    queryKey: programQueryKey(programId),
    queryFn: () => fetchProgram(programId),
    // A 404 is a final answer, not a transient failure.
    retry: false,
  });

  if (query.isPending) {
    return <p className="w-full max-w-xl text-sm text-muted-foreground">Loading…</p>;
  }
  if (query.isError) {
    const missing = query.error instanceof Error && query.error.message === "not_found";
    return (
      <p role="alert" className="w-full max-w-xl text-sm text-destructive">
        {missing ? "Program not found." : "Couldn't load this program."}
      </p>
    );
  }

  // Remount the editor when the program identity changes so its local
  // form state re-seeds from the freshly loaded values.
  return <ProgramEditor key={query.data.id} program={query.data} />;
}

function ProgramEditor({ program }: { program: AdminProgramDetail }) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const [name, setName] = useState(program.name);
  const [slug, setSlug] = useState(program.slug);
  const [blurb, setBlurb] = useState(program.blurb ?? "");
  const [description, setDescription] = useState(program.description ?? "");
  const [buttondownTag, setButtondownTag] = useState(program.buttondownTag ?? "");
  const [editError, setEditError] = useState<string | null>(null);
  const [participantError, setParticipantError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: programQueryKey(program.id) });

  const updateMutation = useMutation({
    mutationFn: async (vars: {
      name?: string;
      slug?: string;
      blurb?: string | null;
      description?: string | null;
      archived?: boolean;
      signupsOpen?: boolean;
      buttondownTag?: string | null;
    }) => {
      const res = await apiClient.api.admin.programs[":id"].$patch({
        param: { id: program.id },
        json: vars,
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(
          body.error === "slug_conflict"
            ? "A program with a similar name already exists."
            : (body.error ?? `admin/programs PATCH: ${res.status}`),
        );
      }
      return res.json();
    },
    onSuccess: () => {
      setEditError(null);
      invalidate();
    },
    onError: (err) => {
      setEditError(err instanceof Error ? err.message : "Failed to save program.");
    },
  });

  const addMutation = useMutation({
    mutationFn: async (profileId: string) => {
      const res = await apiClient.api.admin.programs[":id"].participants.$post({
        param: { id: program.id },
        json: { profileId },
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(
          body.error === "already_member"
            ? "That member is already a participant."
            : (body.error ?? `add participant: ${res.status}`),
        );
      }
      return res.json();
    },
    onSuccess: () => {
      setParticipantError(null);
      invalidate();
    },
    onError: (err) => {
      setParticipantError(err instanceof Error ? err.message : "Failed to add participant.");
    },
  });

  const removeMutation = useMutation({
    mutationFn: async (profileId: string) => {
      const res = await apiClient.api.admin.programs[":id"].participants[":profileId"].$delete({
        param: { id: program.id, profileId },
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `remove participant: ${res.status}`);
      }
      return res.json();
    },
    onSuccess: () => {
      setParticipantError(null);
      invalidate();
    },
    onError: (err) => {
      setParticipantError(err instanceof Error ? err.message : "Failed to remove participant.");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const res = await apiClient.api.admin.programs[":id"].$delete({
        param: { id: program.id },
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(
          body.error === "has_participants"
            ? "Remove every participant before deleting this program."
            : (body.error ?? `admin/programs DELETE: ${res.status}`),
        );
      }
      return res.json();
    },
    onSuccess: () => {
      // The list cache still holds the deleted program; drop it, then
      // leave the now-dead detail page for the programs list.
      queryClient.invalidateQueries({ queryKey: ["admin", "programs"] });
      router.push("/admin/programs");
    },
    onError: (err) => {
      setDeleteError(err instanceof Error ? err.message : "Failed to delete program.");
      setConfirmingDelete(false);
    },
  });

  const trimmedName = name.trim();
  const trimmedSlug = slug.trim();
  const trimmedButtondownTag = buttondownTag.trim();
  const dirty =
    trimmedName !== program.name ||
    trimmedSlug !== program.slug ||
    blurb.trim() !== (program.blurb ?? "") ||
    description.trim() !== (program.description ?? "") ||
    trimmedButtondownTag !== (program.buttondownTag ?? "");

  const save = () => {
    if (!trimmedName) {
      setEditError("Name is required.");
      return;
    }
    if (!trimmedSlug) {
      setEditError("Slug is required.");
      return;
    }
    updateMutation.mutate({
      name: trimmedName,
      slug: trimmedSlug,
      blurb: blurb.trim() || null,
      description: description.trim() || null,
      buttondownTag: trimmedButtondownTag || null,
    });
  };

  const participantIds = program.participants.map((p) => p.id);
  const hasParticipants = program.participants.length > 0;

  return (
    <div className="flex w-full max-w-xl flex-col gap-6">
      <section className="flex flex-col gap-3 rounded border border-border p-3">
        <h2 className="text-base font-semibold uppercase tracking-wide text-muted-foreground">Details</h2>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="program-name">Name</Label>
          <Input
            id="program-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={updateMutation.isPending}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="program-slug">Slug</Label>
          <Input
            id="program-slug"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            disabled={updateMutation.isPending}
          />
          <p className="text-xs text-muted-foreground">Used in URLs — lowercase letters, numbers, and hyphens.</p>
        </div>
        <div className="flex flex-col gap-1.5">
          {/* Editor renders a contenteditable div (no labelable control), so the
              field name rides on the editor's ariaLabel rather than htmlFor. */}
          <Label>Blurb</Label>
          <MarkdownEditor
            variant="inline"
            ariaLabel="Blurb"
            value={blurb}
            onChange={setBlurb}
            disabled={updateMutation.isPending}
            placeholder="One sentence shown on the program card"
          />
          <p className="text-xs text-muted-foreground">Short tagline shown on the programs list. Max 200 characters.</p>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Full description</Label>
          <MarkdownEditor
            variant="full"
            ariaLabel="Full description"
            value={description}
            onChange={setDescription}
            disabled={updateMutation.isPending}
            placeholder="Shown on the program detail page"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="program-buttondown-tag">Buttondown tag</Label>
          <Input
            id="program-buttondown-tag"
            value={buttondownTag}
            onChange={(e) => setButtondownTag(e.target.value)}
            disabled={updateMutation.isPending}
            placeholder="(leave blank to opt out of Buttondown sync)"
          />
          <p className="text-xs text-muted-foreground">
            When set, members joining this program get tagged with this exact string in Buttondown. Leave blank to opt
            out entirely.
          </p>
        </div>
        <Button
          type="button"
          variant="secondary"
          disabled={updateMutation.isPending || !dirty || !trimmedName || !trimmedSlug}
          onClick={save}
          className="self-start"
        >
          {updateMutation.isPending ? "Saving…" : "Save changes"}
        </Button>
        {editError && (
          <p role="alert" className="text-sm text-destructive">
            {editError}
          </p>
        )}
      </section>

      <section className="flex flex-col gap-3 rounded border border-border p-3">
        <h2 className="text-base font-semibold uppercase tracking-wide text-muted-foreground">Visibility</h2>
        <div className="flex flex-col gap-2 text-sm">
          <div className="flex items-center justify-between gap-3">
            <span>
              <span className="font-medium">Signups</span>{" "}
              <span className="text-muted-foreground">
                — {program.signupsOpen ? "members can join from /programs" : "self-serve join is disabled"}
              </span>
            </span>
            <Button
              type="button"
              variant="secondary"
              size="xs"
              disabled={updateMutation.isPending}
              onClick={() => updateMutation.mutate({ signupsOpen: !program.signupsOpen })}
            >
              {program.signupsOpen ? "Close signups" : "Open signups"}
            </Button>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span>
              <span className="font-medium">Archived</span>{" "}
              <span className="text-muted-foreground">
                {program.archivedAt
                  ? `— hidden from /programs since ${formatDate(program.archivedAt)}`
                  : "— visible to members on /programs"}
              </span>
            </span>
            <Button
              type="button"
              variant="secondary"
              size="xs"
              disabled={updateMutation.isPending}
              onClick={() => updateMutation.mutate({ archived: program.archivedAt === null })}
            >
              {program.archivedAt ? "Unarchive" : "Archive"}
            </Button>
          </div>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-base font-semibold uppercase tracking-wide text-muted-foreground">
          Participants ({program.participants.length})
        </h2>
        <MemberTypeahead
          label="Add a participant"
          triggerLabel="Pick a member…"
          selectedIds={participantIds}
          onSelect={(m) => addMutation.mutate(m.id)}
          disabled={addMutation.isPending}
        />
        {participantError && (
          <p role="alert" className="text-sm text-destructive">
            {participantError}
          </p>
        )}
        {program.participants.length === 0 ? (
          <p className="text-sm text-muted-foreground">No participants yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {program.participants.map((p) => (
              <li key={p.id} className="flex items-center gap-3 rounded border border-border p-2 text-sm">
                <Avatar
                  name={p.displayName}
                  url={p.avatarUrl}
                  className="flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted text-[10px] font-semibold text-muted-foreground"
                />
                <span>{p.displayName ?? "—"}</span>
                <Button
                  type="button"
                  variant="destructive"
                  size="xs"
                  disabled={removeMutation.isPending}
                  onClick={() => removeMutation.mutate(p.id)}
                  className="ml-auto"
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        )}
        {hasParticipants && (
          <div className="flex flex-col gap-2 border-t border-border pt-3">
            <h3 className="text-sm font-medium">Email addresses</h3>
            <ProgramEmailsPanel programId={program.id} />
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3 rounded border border-destructive/40 p-3">
        <h2 className="text-base font-semibold uppercase tracking-wide text-muted-foreground">Delete program</h2>
        <p className="text-sm text-muted-foreground">
          {hasParticipants
            ? "Remove every participant before deleting. Programs in real use will get a dedicated retire flow later."
            : "Permanently deletes this empty program. This can't be undone."}
        </p>
        {confirmingDelete ? (
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="destructive"
              disabled={deleteMutation.isPending}
              onClick={() => deleteMutation.mutate()}
            >
              {deleteMutation.isPending ? "Deleting…" : "Yes, delete program"}
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={deleteMutation.isPending}
              onClick={() => setConfirmingDelete(false)}
            >
              Cancel
            </Button>
          </div>
        ) : (
          <Button
            type="button"
            variant="destructive"
            disabled={hasParticipants}
            onClick={() => {
              setDeleteError(null);
              setConfirmingDelete(true);
            }}
            className="self-start"
          >
            Delete program
          </Button>
        )}
        {deleteError && (
          <p role="alert" className="text-sm text-destructive">
            {deleteError}
          </p>
        )}
      </section>
    </div>
  );
}
