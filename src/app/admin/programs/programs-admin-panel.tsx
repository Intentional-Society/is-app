"use client";

import { useCallback, useState } from "react";

import { apiClient } from "@/lib/api";
import type { AdminMember, AdminProgram, AdminProgramMember } from "@/lib/api-types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type SaveState = { kind: "idle" } | { kind: "saving" } | { kind: "error"; message: string };
type Tab = "settings" | "members";

const toSlug = (name: string) =>
  name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}

export function ProgramsAdminPanel({ programs: initialPrograms }: { programs: AdminProgram[] }) {
  const [programs, setPrograms] = useState<AdminProgram[]>(initialPrograms);

  // Create form
  const [showCreate, setShowCreate] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createSlug, setCreateSlug] = useState("");
  const [createSlugTouched, setCreateSlugTouched] = useState(false);
  const [createSlugCustomizing, setCreateSlugCustomizing] = useState(false);
  const [createDesc, setCreateDesc] = useState("");
  const [createActive, setCreateActive] = useState(true);
  const [createState, setCreateState] = useState<SaveState>({ kind: "idle" });

  // Selected program (expanded row with tabs)
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedTab, setSelectedTab] = useState<Tab>("settings");

  // Edit form (inside Settings tab)
  const [editName, setEditName] = useState("");
  const [editSlug, setEditSlug] = useState("");
  const [editSlugCustomizing, setEditSlugCustomizing] = useState(false);
  const [editDesc, setEditDesc] = useState("");
  const [editActive, setEditActive] = useState(true);
  const [editState, setEditState] = useState<SaveState>({ kind: "idle" });

  // Member management (inside Members tab)
  const [programMembers, setProgramMembers] = useState<Record<string, AdminProgramMember[]>>({});
  const [allMembers, setAllMembers] = useState<AdminMember[] | null>(null);
  const [memberSearch, setMemberSearch] = useState("");
  const [memberOpState, setMemberOpState] = useState<SaveState>({ kind: "idle" });

  const [deleteError, setDeleteError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const res = await apiClient.api.admin.programs.$get();
    if (res.ok) {
      const { programs: loaded } = await res.json();
      setPrograms(loaded);
    }
  }, []);

  const selectProgram = (program: AdminProgram) => {
    if (selectedId === program.id) {
      setSelectedId(null);
      return;
    }
    setSelectedId(program.id);
    setSelectedTab("settings");
    setEditName(program.name);
    setEditSlug(program.slug);
    setEditSlugCustomizing(false);
    setEditDesc(program.description ?? "");
    setEditActive(program.isActive);
    setEditState({ kind: "idle" });
    setMemberSearch("");
    setMemberOpState({ kind: "idle" });
  };

  const handleMembersTab = async (programId: string) => {
    setSelectedTab("members");
    if (!programMembers[programId]) {
      const res = await apiClient.api.admin.programs[":id"].members.$get({ param: { id: programId } });
      if (res.ok) {
        const { members } = await res.json();
        setProgramMembers((prev) => ({ ...prev, [programId]: members }));
      }
    }
    if (allMembers === null) {
      const res = await apiClient.api.admin.members.$get();
      if (res.ok) {
        const { members } = await res.json();
        setAllMembers(members);
      }
    }
  };

  const handleCreate = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setCreateState({ kind: "saving" });
    try {
      const res = await apiClient.api.admin.programs.$post({
        json: {
          name: createName,
          slug: createSlug || undefined,
          description: createDesc || undefined,
          isActive: createActive,
        },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const error = (body as Record<string, unknown>).error;
        if (res.status === 409 && error === "slug_taken") {
          setCreateState({ kind: "error", message: "This URL slug is already in use by another program." });
          return;
        }
        setCreateState({ kind: "error", message: `Failed to create program (${res.status}).` });
        return;
      }
      setCreateName("");
      setCreateSlug("");
      setCreateSlugTouched(false);
      setCreateSlugCustomizing(false);
      setCreateDesc("");
      setCreateActive(true);
      setCreateState({ kind: "idle" });
      setShowCreate(false);
      await reload();
    } catch {
      setCreateState({ kind: "error", message: "Network error. Please try again." });
    }
  };

  const handleEdit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!selectedId) return;
    setEditState({ kind: "saving" });
    try {
      const res = await apiClient.api.admin.programs[":id"].$put(
        {
          param: { id: selectedId },
          json: { name: editName, slug: editSlug || undefined, description: editDesc || null, isActive: editActive },
        } as never,
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const error = (body as Record<string, unknown>).error;
        if (res.status === 409 && error === "slug_taken") {
          setEditState({ kind: "error", message: "This URL slug is already in use by another program." });
          return;
        }
        setEditState({ kind: "error", message: `Failed to update program (${res.status}).` });
        return;
      }
      setEditState({ kind: "idle" });
      await reload();
    } catch {
      setEditState({ kind: "error", message: "Network error. Please try again." });
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm("Delete this program? This cannot be undone.")) return;
    setDeleteError(null);
    try {
      const res = await apiClient.api.admin.programs[":id"].$delete({ param: { id } });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const b = body as Record<string, unknown>;
        if (res.status === 409 && b.error === "has_members") {
          const memberCount = typeof b.memberCount === "number" ? b.memberCount : "some";
          setDeleteError(`Cannot delete — this program has ${memberCount} member(s). Remove them first.`);
          return;
        }
        setDeleteError(`Failed to delete program (${res.status}).`);
        return;
      }
      if (selectedId === id) setSelectedId(null);
      setPrograms((prev) => prev.filter((p) => p.id !== id));
    } catch {
      setDeleteError("Network error. Please try again.");
    }
  };

  const handleRemoveMember = async (programId: string, profileId: string) => {
    setMemberOpState({ kind: "saving" });
    try {
      const res = await apiClient.api.admin.programs[":id"].members[":profileId"].$delete({
        param: { id: programId, profileId },
      });
      if (!res.ok) {
        setMemberOpState({ kind: "error", message: `Failed to remove member (${res.status}).` });
        return;
      }
      setProgramMembers((prev) => ({
        ...prev,
        [programId]: (prev[programId] ?? []).filter((m) => m.id !== profileId),
      }));
      setPrograms((prev) =>
        prev.map((p) =>
          p.id === programId ? { ...p, memberCount: Math.max(0, p.memberCount - 1) } : p,
        ),
      );
      setMemberOpState({ kind: "idle" });
    } catch {
      setMemberOpState({ kind: "error", message: "Network error. Please try again." });
    }
  };

  const handleAssignMember = async (programId: string, profileId: string) => {
    setMemberOpState({ kind: "saving" });
    try {
      const res = await apiClient.api.admin.programs[":id"].members.$post(
        { param: { id: programId }, json: { profileId } } as never,
      );
      if (!res.ok) {
        setMemberOpState({ kind: "error", message: `Failed to assign member (${res.status}).` });
        return;
      }
      const assigned = allMembers?.find((m) => m.id === profileId);
      if (assigned) {
        const newMember: AdminProgramMember = {
          id: assigned.id,
          displayName: assigned.displayName,
          slug: assigned.slug,
          avatarUrl: assigned.avatarUrl,
          assignedAt: new Date().toISOString(),
        };
        setProgramMembers((prev) => ({
          ...prev,
          [programId]: [...(prev[programId] ?? []), newMember],
        }));
        setPrograms((prev) =>
          prev.map((p) =>
            p.id === programId ? { ...p, memberCount: p.memberCount + 1 } : p,
          ),
        );
      }
      setMemberSearch("");
      setMemberOpState({ kind: "idle" });
    } catch {
      setMemberOpState({ kind: "error", message: "Network error. Please try again." });
    }
  };

  return (
    <section className="flex w-full max-w-3xl flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Programs</h2>
        <Button
          size="sm"
          onClick={() => {
            setShowCreate((v) => !v);
            setCreateName("");
            setCreateSlug("");
            setCreateSlugTouched(false);
            setCreateSlugCustomizing(false);
            setCreateDesc("");
            setCreateActive(true);
            setCreateState({ kind: "idle" });
          }}
        >
          {showCreate ? "Cancel" : "New program"}
        </Button>
      </div>

      {deleteError && (
        <p role="alert" className="text-sm text-destructive">
          {deleteError}
        </p>
      )}

      {showCreate && (
        <form
          onSubmit={handleCreate}
          className="flex flex-col gap-3 rounded border border-border p-4"
        >
          <h3 className="font-semibold">New program</h3>

          <div className="flex flex-col gap-1">
            <Label htmlFor="create-name">Name</Label>
            <Input
              id="create-name"
              required
              value={createName}
              onChange={(e) => {
                setCreateName(e.target.value);
                if (!createSlugTouched) setCreateSlug(toSlug(e.target.value));
              }}
              disabled={createState.kind === "saving"}
            />
            {createName && (
              <p className="text-sm text-muted-foreground">
                URL: /programs/
                <span className="font-mono">{createSlug || "…"}</span>
                {!createSlugCustomizing && (
                  <button
                    type="button"
                    className="ml-2 text-primary underline"
                    onClick={() => setCreateSlugCustomizing(true)}
                  >
                    Customize
                  </button>
                )}
              </p>
            )}
          </div>

          {createSlugCustomizing && (
            <div className="flex flex-col gap-1">
              <Label htmlFor="create-slug">URL slug</Label>
              <Input
                id="create-slug"
                value={createSlug}
                onChange={(e) => {
                  setCreateSlug(e.target.value);
                  setCreateSlugTouched(true);
                }}
                disabled={createState.kind === "saving"}
              />
              {createSlug !== toSlug(createName) && createSlug !== "" && (
                <p className="text-sm text-amber-600">
                  Heads up: changing the slug will break any existing links to this program.
                </p>
              )}
            </div>
          )}

          <div className="flex flex-col gap-1">
            <Label htmlFor="create-desc">Description</Label>
            <Textarea
              id="create-desc"
              rows={2}
              value={createDesc}
              onChange={(e) => setCreateDesc(e.target.value)}
              disabled={createState.kind === "saving"}
            />
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="create-active"
              checked={createActive}
              onChange={(e) => setCreateActive(e.target.checked)}
              className="h-4 w-4"
            />
            <Label htmlFor="create-active">Active (visible to members)</Label>
          </div>

          <div className="flex items-center gap-2">
            <Button type="submit" size="sm" disabled={createState.kind === "saving"}>
              {createState.kind === "saving" ? "Creating…" : "Create program"}
            </Button>
          </div>

          {createState.kind === "error" && (
            <p role="alert" className="text-sm text-destructive">
              {createState.message}
            </p>
          )}
        </form>
      )}

      <ul className="flex flex-col gap-2">
        {programs.map((program) => {
          const isSelected = selectedId === program.id;
          const memberCount = program.memberCount;

          return (
            <li
              key={program.id}
              className={`rounded border border-border${!program.isActive ? " opacity-60" : ""}`}
            >
              {/* Row header — click to expand/collapse */}
              <div className="flex items-start gap-2 p-3">
                <button
                  type="button"
                  className="flex flex-1 items-start gap-2 text-left"
                  onClick={() => selectProgram(program)}
                >
                  <span className="mt-1 shrink-0 text-xs text-muted-foreground">
                    {isSelected ? "▼" : "▶"}
                  </span>
                  <span className="flex flex-col gap-0.5">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">{program.name}</span>
                      {!program.isActive && (
                        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          Inactive
                        </span>
                      )}
                      <span className="text-sm text-muted-foreground">
                        {memberCount} {memberCount === 1 ? "member" : "members"}
                      </span>
                    </span>
                    <span className="text-sm text-muted-foreground">
                      Created {formatDate(program.createdAt)}
                    </span>
                  </span>
                </button>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => handleDelete(program.id)}
                >
                  Delete
                </Button>
              </div>

              {/* Tab panel */}
              {isSelected && (
                <div className="border-t border-border">
                  {/* Tab headers */}
                  <div className="flex border-b border-border">
                    <button
                      type="button"
                      className={`px-4 py-2 text-sm font-medium transition-colors ${
                        selectedTab === "settings"
                          ? "border-b-2 border-primary text-primary"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                      onClick={() => setSelectedTab("settings")}
                    >
                      Settings
                    </button>
                    <button
                      type="button"
                      className={`px-4 py-2 text-sm font-medium transition-colors ${
                        selectedTab === "members"
                          ? "border-b-2 border-primary text-primary"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                      onClick={() => handleMembersTab(program.id)}
                    >
                      Members ({memberCount})
                    </button>
                  </div>

                  {/* Settings tab */}
                  {selectedTab === "settings" && (
                    <form onSubmit={handleEdit} className="flex flex-col gap-3 p-4">
                      <div className="flex flex-col gap-1">
                        <Label htmlFor={`edit-name-${program.id}`}>Name</Label>
                        <Input
                          id={`edit-name-${program.id}`}
                          required
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          disabled={editState.kind === "saving"}
                        />
                        <p className="text-sm text-muted-foreground">
                          URL: /programs/
                          <span className="font-mono">{editSlug || "…"}</span>
                          {!editSlugCustomizing && (
                            <button
                              type="button"
                              className="ml-2 text-primary underline"
                              onClick={() => setEditSlugCustomizing(true)}
                            >
                              Customize
                            </button>
                          )}
                        </p>
                      </div>

                      {editSlugCustomizing && (
                        <div className="flex flex-col gap-1">
                          <Label htmlFor={`edit-slug-${program.id}`}>URL slug</Label>
                          <Input
                            id={`edit-slug-${program.id}`}
                            value={editSlug}
                            onChange={(e) => setEditSlug(e.target.value)}
                            disabled={editState.kind === "saving"}
                          />
                          {editSlug !== toSlug(editName) && editSlug !== "" && (
                            <p className="text-sm text-amber-600">
                              Heads up: changing the slug will break any existing links to this program.
                            </p>
                          )}
                        </div>
                      )}

                      <div className="flex flex-col gap-1">
                        <Label htmlFor={`edit-desc-${program.id}`}>Description</Label>
                        <Textarea
                          id={`edit-desc-${program.id}`}
                          rows={2}
                          value={editDesc}
                          onChange={(e) => setEditDesc(e.target.value)}
                          disabled={editState.kind === "saving"}
                        />
                      </div>

                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          id={`edit-active-${program.id}`}
                          checked={editActive}
                          onChange={(e) => setEditActive(e.target.checked)}
                          className="h-4 w-4"
                        />
                        <Label htmlFor={`edit-active-${program.id}`}>Active (visible to members)</Label>
                      </div>

                      <div className="flex items-center gap-2">
                        <Button type="submit" size="sm" disabled={editState.kind === "saving"}>
                          {editState.kind === "saving" ? "Saving…" : "Save changes"}
                        </Button>
                      </div>

                      {editState.kind === "error" && (
                        <p role="alert" className="text-sm text-destructive">
                          {editState.message}
                        </p>
                      )}
                    </form>
                  )}

                  {/* Members tab */}
                  {selectedTab === "members" && (
                    <div className="flex flex-col gap-3 p-4">
                      {memberOpState.kind === "error" && (
                        <p role="alert" className="text-sm text-destructive">
                          {memberOpState.message}
                        </p>
                      )}

                      {programMembers[program.id] === undefined ? (
                        <p className="text-sm text-muted-foreground">Loading…</p>
                      ) : (programMembers[program.id] ?? []).length === 0 ? (
                        <p className="text-sm text-muted-foreground">No members yet.</p>
                      ) : (
                        <ul className="flex flex-col gap-1">
                          {(programMembers[program.id] ?? []).map((m) => (
                            <li key={m.id} className="flex items-center gap-2">
                              {m.avatarUrl ? (
                                <img
                                  src={m.avatarUrl}
                                  alt=""
                                  className="h-6 w-6 rounded-full object-cover"
                                />
                              ) : (
                                <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs text-muted-foreground">
                                  {m.displayName ? m.displayName[0].toUpperCase() : "?"}
                                </div>
                              )}
                              <span className="flex-1 text-sm">{m.displayName ?? "(unnamed)"}</span>
                              <Button
                                size="sm"
                                variant="ghost"
                                disabled={memberOpState.kind === "saving"}
                                onClick={() => handleRemoveMember(program.id, m.id)}
                              >
                                Remove
                              </Button>
                            </li>
                          ))}
                        </ul>
                      )}

                      <div className="flex flex-col gap-1 border-t border-border pt-3">
                        <Label htmlFor={`member-search-${program.id}`}>Add member</Label>
                        <Input
                          id={`member-search-${program.id}`}
                          placeholder="Search by name…"
                          value={memberSearch}
                          onChange={(e) => setMemberSearch(e.target.value)}
                        />
                        {memberSearch && allMembers && (
                          <ul className="mt-1 flex flex-col gap-1 rounded border border-border p-1">
                            {allMembers
                              .filter(
                                (m) =>
                                  !(programMembers[program.id] ?? []).some((pm) => pm.id === m.id) &&
                                  (m.displayName ?? "")
                                    .toLowerCase()
                                    .includes(memberSearch.toLowerCase()),
                              )
                              .slice(0, 10)
                              .map((m) => (
                                <li key={m.id}>
                                  <button
                                    type="button"
                                    className="w-full rounded px-2 py-1 text-left text-sm hover:bg-muted"
                                    disabled={memberOpState.kind === "saving"}
                                    onClick={() => handleAssignMember(program.id, m.id)}
                                  >
                                    {m.displayName ?? "(unnamed)"}
                                    {m.location && (
                                      <span className="ml-1 text-muted-foreground">— {m.location}</span>
                                    )}
                                  </button>
                                </li>
                              ))}
                          </ul>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
