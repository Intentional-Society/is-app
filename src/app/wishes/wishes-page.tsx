"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { apiClient } from "@/lib/api";
import type { DiscoverProfile, Wish } from "@/lib/api-types";

import { discoverWishesQueryKey, HYDRATED_STALE_TIME, wishesQueryKey } from "./query-keys";

const fetchWishes = async () => {
  const res = await apiClient.api.wishes.$get();
  if (!res.ok) throw new Error("Couldn't load wishes");
  return res.json();
};

const fetchDiscover = async () => {
  const res = await apiClient.api.wishes.discover.$get();
  if (!res.ok) throw new Error("Couldn't load discover");
  return res.json();
};

export function WishesContent() {
  const query = useQuery({
    queryKey: wishesQueryKey(),
    queryFn: fetchWishes,
    staleTime: HYDRATED_STALE_TIME,
  });

  const [showCreate, setShowCreate] = useState(false);
  const [showDiscover, setShowDiscover] = useState(false);

  if (query.isPending) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (query.isError)
    return (
      <p role="alert" className="text-sm text-destructive">
        Couldn&apos;t load your wishes.
      </p>
    );

  const { wishes } = query.data;
  const currentWishes = wishes.filter((w) => w.status === "active");
  const pastWishes = wishes.filter((w) => w.status !== "active");

  return (
    <div className="flex w-full max-w-md flex-col gap-6">
      <div className="flex gap-2">
        <Button
          type="button"
          variant="secondary"
          onClick={() => {
            setShowCreate(true);
            setShowDiscover(false);
          }}
          disabled={showCreate}
        >
          Make a Wish
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            setShowDiscover(!showDiscover);
            setShowCreate(false);
          }}
        >
          {showDiscover ? "Hide Discover" : "Discover Wishes"}
        </Button>
      </div>

      {showCreate && <CreateWishForm onDone={() => setShowCreate(false)} />}

      {showDiscover && <DiscoverSection />}

      <section className="flex flex-col gap-3" aria-labelledby="current-wishes-heading">
        <h2 id="current-wishes-heading" className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Current Wishes
        </h2>
        {currentWishes.length === 0 ? (
          <p className="text-sm text-muted-foreground">No wishes yet. Make one!</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {currentWishes.map((wish) => (
              <WishItem key={wish.id} wish={wish} />
            ))}
          </ul>
        )}
      </section>

      {pastWishes.length > 0 && (
        <section className="flex flex-col gap-3" aria-labelledby="past-wishes-heading">
          <h2 id="past-wishes-heading" className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Past / Fulfilled Wishes
          </h2>
          <ul className="flex flex-col gap-2">
            {pastWishes.map((wish) => (
              <WishItem key={wish.id} wish={wish} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function CreateWishForm({ onDone }: { onDone: () => void }) {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await apiClient.api.wishes.$post({
        json: { title: title.trim(), description: description.trim() || null },
      });
      if (!res.ok) throw new Error("Couldn't create wish");
      return res.json();
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: wishesQueryKey() });
      onDone();
    },
  });

  return (
    <form
      className="flex flex-col gap-3 rounded-md border border-border bg-muted/30 p-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (title.trim() && !createMutation.isPending) createMutation.mutate();
      }}
    >
      <h3 className="text-sm font-semibold">New Wish</h3>
      <div className="flex flex-col gap-1">
        <Label htmlFor="wish-title">Title</Label>
        <Input
          id="wish-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="What do you wish for?"
          disabled={createMutation.isPending}
          autoFocus
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="wish-description">
          Description <span className="text-muted-foreground">(optional)</span>
        </Label>
        <Textarea
          id="wish-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What is this wish about? How could others help?"
          rows={3}
          disabled={createMutation.isPending}
        />
      </div>
      <div className="flex items-center gap-2">
        <Button type="submit" variant="secondary" disabled={!title.trim() || createMutation.isPending}>
          {createMutation.isPending ? "Saving…" : "Save wish"}
        </Button>
        <Button type="button" variant="ghost" disabled={createMutation.isPending} onClick={onDone}>
          Cancel
        </Button>
      </div>
      {createMutation.isError && (
        <p role="alert" className="text-sm text-destructive">
          {createMutation.error.message}
        </p>
      )}
    </form>
  );
}

function DeleteButton({
  disabled,
  onConfirm,
  isPending,
}: {
  disabled: boolean;
  onConfirm: () => void;
  isPending: boolean;
}) {
  return (
    <Dialog>
      <DialogTrigger render={<Button type="button" variant="destructive" size="xs" disabled={disabled} />}>
        {isPending ? "Deleting…" : "Delete"}
      </DialogTrigger>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Delete this wish?</DialogTitle>
          <DialogDescription>
            Consider archiving instead — deleted wishes are gone for good. Archive keeps a record of what you&apos;ve
            wished for.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
          <DialogClose render={<Button variant="destructive" onClick={onConfirm} />}>Delete anyway</DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function WishItem({ wish }: { wish: Wish }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);

  const statusMutation = useMutation({
    mutationFn: async (status: "active" | "archived" | "fulfilled") => {
      const res = await apiClient.api.wishes[":id"].$patch({
        param: { id: wish.id },
        json: { status },
      });
      if (!res.ok) throw new Error("Couldn't update wish");
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: wishesQueryKey() }),
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const res = await apiClient.api.wishes[":id"].$delete({ param: { id: wish.id } });
      if (!res.ok) throw new Error("Couldn't delete wish");
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: wishesQueryKey() }),
  });

  const busy = statusMutation.isPending || deleteMutation.isPending;

  const cardClass =
    wish.status === "fulfilled"
      ? "flex flex-col gap-2 rounded-md border border-green-300 bg-green-50/40 p-3 dark:border-green-800 dark:bg-green-950/20"
      : wish.status === "archived"
        ? "flex flex-col gap-2 rounded-md border border-border bg-muted/30 p-3 opacity-70"
        : "flex flex-col gap-2 rounded-md border border-border bg-background p-3";

  const reopenLabel = wish.status === "fulfilled" ? "Unfulfill" : "Reopen";

  return (
    <li className={cardClass}>
      {editing ? (
        <EditWishForm wish={wish} onDone={() => setEditing(false)} />
      ) : (
        <>
          <div className="flex flex-col gap-1">
            <span className="text-sm font-medium">{wish.title}</span>
            {wish.description && <span className="text-sm text-muted-foreground">{wish.description}</span>}
            {wish.status === "fulfilled" && (
              <span className="inline-flex w-fit items-center rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800 dark:bg-green-900/40 dark:text-green-300">
                Fulfilled ✓
              </span>
            )}
            {wish.status === "archived" && (
              <span className="inline-flex w-fit items-center rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                Archived
              </span>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {wish.status === "active" ? (
              <>
                <Button type="button" variant="ghost" size="xs" disabled={busy} onClick={() => setEditing(true)}>
                  Edit
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  disabled={busy}
                  onClick={() => statusMutation.mutate("fulfilled")}
                >
                  {statusMutation.variables === "fulfilled" && statusMutation.isPending ? "Saving…" : "Fulfill"}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  disabled={busy}
                  onClick={() => statusMutation.mutate("archived")}
                >
                  {statusMutation.variables === "archived" && statusMutation.isPending ? "Saving…" : "Archive"}
                </Button>
                <DeleteButton
                  disabled={busy}
                  onConfirm={() => deleteMutation.mutate()}
                  isPending={deleteMutation.isPending}
                />
              </>
            ) : (
              <>
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  disabled={busy}
                  onClick={() => statusMutation.mutate("active")}
                >
                  {statusMutation.isPending ? "Saving…" : reopenLabel}
                </Button>
                {wish.status === "archived" && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    disabled={busy}
                    onClick={() => statusMutation.mutate("fulfilled")}
                  >
                    {statusMutation.variables === "fulfilled" && statusMutation.isPending ? "Saving…" : "Fulfill"}
                  </Button>
                )}
                <DeleteButton
                  disabled={busy}
                  onConfirm={() => deleteMutation.mutate()}
                  isPending={deleteMutation.isPending}
                />
              </>
            )}
          </div>
          {(statusMutation.isError || deleteMutation.isError) && (
            <p role="alert" className="text-sm text-destructive">
              {statusMutation.error?.message ?? deleteMutation.error?.message}
            </p>
          )}
        </>
      )}
    </li>
  );
}

function EditWishForm({ wish, onDone }: { wish: Wish; onDone: () => void }) {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState(wish.title);
  const [description, setDescription] = useState(wish.description ?? "");

  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await apiClient.api.wishes[":id"].$patch({
        param: { id: wish.id },
        json: { title: title.trim(), description: description.trim() || null },
      });
      if (!res.ok) throw new Error("Couldn't save wish");
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: wishesQueryKey() });
      onDone();
    },
  });

  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (title.trim() && !saveMutation.isPending) saveMutation.mutate();
      }}
    >
      <Input
        aria-label="Wish title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        disabled={saveMutation.isPending}
        autoFocus
      />
      <Textarea
        aria-label="Wish description"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        rows={3}
        disabled={saveMutation.isPending}
        placeholder="Description (optional)"
      />
      <div className="flex items-center gap-2">
        <Button type="submit" variant="secondary" size="xs" disabled={!title.trim() || saveMutation.isPending}>
          {saveMutation.isPending ? "Saving…" : "Save"}
        </Button>
        <Button type="button" variant="ghost" size="xs" disabled={saveMutation.isPending} onClick={onDone}>
          Cancel
        </Button>
      </div>
      {saveMutation.isError && (
        <p role="alert" className="text-sm text-destructive">
          {saveMutation.error.message}
        </p>
      )}
    </form>
  );
}

function DiscoverSection() {
  const query = useQuery({
    queryKey: discoverWishesQueryKey(),
    queryFn: fetchDiscover,
  });

  if (query.isPending) return <p className="text-sm text-muted-foreground">Finding wishes…</p>;
  if (query.isError)
    return (
      <p role="alert" className="text-sm text-destructive">
        Couldn&apos;t load discover.
      </p>
    );

  const { profiles } = query.data;

  return (
    <section className="flex flex-col gap-3" aria-labelledby="discover-heading">
      <h2 id="discover-heading" className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        Discover Wishes
      </h2>
      {profiles.length === 0 ? (
        <p className="text-sm text-muted-foreground">No members with active wishes right now.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {profiles.map((profile: DiscoverProfile) => (
            <li key={profile.id}>
              <Link
                href={`/members/${profile.slug ?? profile.id}`}
                className="flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm hover:bg-muted"
              >
                {profile.displayName ?? "Member"}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
