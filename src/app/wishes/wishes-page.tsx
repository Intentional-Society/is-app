"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronUp, CircleHelp, MessageCircle } from "lucide-react";
import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { useEffect, useState } from "react";

import { LocalTime } from "@/components/local-time";
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
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { apiClient } from "@/lib/api";
import type { DiscoverWish, Wish, WishComment } from "@/lib/api-types";

import {
  discoverWishesQueryKey,
  HYDRATED_STALE_TIME,
  wishCommentsQueryKey,
  wishesQueryKey,
  wishReactionsQueryKey,
} from "./query-keys";

// Fixed reaction set.
const REACTIONS = [
  { key: "love", emoji: "❤️", label: "Love it!" },
  { key: "me_too", emoji: "🙌", label: "Me too!" },
  { key: "supportive", emoji: "🌟", label: "Supportive" },
  { key: "help", emoji: "🤝", label: "Let me help!" },
] as const;

type ReactionKey = (typeof REACTIONS)[number]["key"];

// Emerge animation helper — staggered per element index.
const emerge = (i: number): CSSProperties => ({
  animation: `wish-emerge 0.75s ease-out both`,
  animationDelay: `${i * 150}ms`,
});

// ─── Shared interactions ──────────────────────────────────────────────────────

function WishReactions({ wishId, isOwnWish }: { wishId: string; isOwnWish: boolean }) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: wishReactionsQueryKey(wishId),
    queryFn: async () => {
      const res = await apiClient.api.wishes[":id"].reactions.$get({ param: { id: wishId } });
      if (!res.ok) throw new Error("failed");
      return res.json();
    },
  });

  const toggleMutation = useMutation({
    mutationFn: async (emoji: ReactionKey) => {
      const res = await apiClient.api.wishes[":id"].reactions.$post({
        param: { id: wishId },
        json: { emoji },
      });
      if (!res.ok) throw new Error("failed");
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: wishReactionsQueryKey(wishId) }),
  });

  const counts = (query.data?.counts ?? {}) as Record<string, number>;
  const mySet = new Set<ReactionKey>((query.data?.mine ?? []) as ReactionKey[]);

  return (
    <div className="flex flex-wrap items-center gap-1">
      {REACTIONS.map(({ key, emoji, label }) => {
        const count = counts[key] ?? 0;
        const active = mySet.has(key);
        return (
          <button
            key={key}
            type="button"
            disabled={isOwnWish || query.isPending || toggleMutation.isPending}
            onClick={() => !isOwnWish && !query.isPending && toggleMutation.mutate(key)}
            title={isOwnWish ? "Can't react to your own wish" : active ? `Remove "${label}"` : label}
            className={[
              "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition-colors",
              active
                ? "border-black/40 bg-black/20 font-semibold dark:border-white/50 dark:bg-white/25"
                : "border-black/[0.08] bg-black/[0.03] dark:border-white/[0.1] dark:bg-white/[0.03]",
              isOwnWish || query.isPending
                ? "cursor-default opacity-50"
                : "cursor-pointer hover:border-black/20 hover:bg-black/[0.08] dark:hover:border-white/25 dark:hover:bg-white/[0.08]",
            ].join(" ")}
          >
            <span role="img" aria-label={label}>
              {emoji}
            </span>
            <span>{label}</span>
            {count > 0 && <span className="font-medium tabular-nums">{count}</span>}
          </button>
        );
      })}
    </div>
  );
}

function WishCommentsList({
  wishId,
  currentUserId,
  onCountChange,
}: {
  wishId: string;
  currentUserId: string;
  onCountChange?: (count: number) => void;
}) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState("");

  const query = useQuery({
    queryKey: wishCommentsQueryKey(wishId),
    queryFn: async () => {
      const res = await apiClient.api.wishes[":id"].comments.$get({ param: { id: wishId } });
      if (!res.ok) throw new Error("failed");
      return res.json();
    },
  });

  const addMutation = useMutation({
    mutationFn: async (body: string) => {
      const res = await apiClient.api.wishes[":id"].comments.$post({
        param: { id: wishId },
        json: { body },
      });
      if (!res.ok) throw new Error("Couldn't post comment");
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: wishCommentsQueryKey(wishId) });
      setDraft("");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (commentId: string) => {
      const res = await apiClient.api.wishes[":id"].comments[":commentId"].$delete({
        param: { id: wishId, commentId },
      });
      if (!res.ok) throw new Error("Couldn't delete comment");
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: wishCommentsQueryKey(wishId) }),
  });

  const comments = query.data?.comments ?? [];

  useEffect(() => {
    if (!query.isPending) onCountChange?.(comments.length);
  }, [comments.length, query.isPending, onCountChange]);

  return (
    <div className="flex flex-col gap-3">
      {query.isPending && <p className="text-xs text-foreground/50">Loading…</p>}
      {comments.map((c: WishComment) => (
        <div key={c.id} className="flex flex-col gap-0.5">
          <div className="flex items-baseline gap-2">
            <Link href={`/members/${c.authorSlug ?? c.authorId}`} className="text-xs font-medium hover:underline">
              {c.authorDisplayName ?? "Member"}
            </Link>
            <span className="text-xs text-foreground/50">
              <LocalTime iso={c.createdAt as unknown as string} />
            </span>
            {c.authorId === currentUserId && (
              <button
                type="button"
                onClick={() => deleteMutation.mutate(c.id)}
                disabled={deleteMutation.isPending}
                className="ml-auto text-xs text-foreground/50 hover:text-destructive"
              >
                Delete
              </button>
            )}
          </div>
          <p className="text-sm">{c.body}</p>
        </div>
      ))}
      <form
        className="flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (draft.trim() && !addMutation.isPending) addMutation.mutate(draft.trim());
        }}
      >
        <Textarea
          aria-label="Comment"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Leave a comment…"
          rows={2}
          disabled={addMutation.isPending}
        />
        <div className="flex gap-2">
          <Button type="submit" variant="secondary" size="xs" disabled={!draft.trim() || addMutation.isPending}>
            {addMutation.isPending ? "Posting…" : "Post"}
          </Button>
        </div>
        {addMutation.isError && (
          <p role="alert" className="text-xs text-destructive">
            {addMutation.error.message}
          </p>
        )}
      </form>
    </div>
  );
}

// ─── Wishing card colors ──────────────────────────────────────────────────────
const TANZAKU_PALETTES = [
  { bg: "bg-[#E2D9F5] dark:bg-[#403453]", text: "text-[#34333D] dark:text-[#E5D8FA]" }, // Lilac
  { bg: "bg-[#F9DFE6] dark:bg-[#50343F]", text: "text-[#34333D] dark:text-[#F5D6E2]" }, // Blush
  { bg: "bg-[#D8E4FA] dark:bg-[#303F5C]", text: "text-[#34333D] dark:text-[#D7E3FF]" }, // Periwinkle
  { bg: "bg-[#FBEDBE] dark:bg-[#50462D]", text: "text-[#34333D] dark:text-[#F7E6B3]" }, // Sunlight
  { bg: "bg-[#D7EDDF] dark:bg-[#2D473E]", text: "text-[#34333D] dark:text-[#D0EFDF]" }, // Mint
] as const;

type TanzakuPalette = (typeof TANZAKU_PALETTES)[number] | { bg: string; text: string };

function wishPalette(id: string): (typeof TANZAKU_PALETTES)[number] {
  const hash = [...id].reduce((acc, c) => acc + c.charCodeAt(0), 0);
  return TANZAKU_PALETTES[hash % TANZAKU_PALETTES.length];
}

// ─── Interaction strip ────────────────────────────────────────────────────────

function InteractionStrip({
  wishId,
  currentUserId,
  isOwnWish,
  manageSlot,
}: {
  wishId: string;
  currentUserId: string;
  isOwnWish: boolean;
  manageSlot?: ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const [showComments, setShowComments] = useState(false);
  const [commentCount, setCommentCount] = useState<number | undefined>(undefined);

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        aria-label="React or comment"
        className="flex w-full items-center justify-center gap-1 border-t border-black/10 pt-2 opacity-30 transition-opacity hover:opacity-60 dark:border-white/10"
      >
        {REACTIONS.map((r) => (
          <span key={r.key} role="img" aria-label={r.label} className="text-sm leading-none">
            {r.emoji}
          </span>
        ))}
        <MessageCircle className="ml-1 size-3.5" />
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-2 border-t border-black/10 pt-2 dark:border-white/10">
        <WishReactions wishId={wishId} isOwnWish={isOwnWish} />
        <div className="flex items-center">
          <button
            type="button"
            onClick={() => setShowComments((v) => !v)}
            aria-label={showComments ? "Hide comments" : "Show comments"}
            className={[
              "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs transition-colors",
              showComments
                ? "bg-black/15 dark:bg-white/20"
                : "text-foreground/50 hover:bg-black/[0.08] dark:hover:bg-white/[0.08]",
            ].join(" ")}
          >
            <MessageCircle className="size-3.5" />
            <span>Comment</span>
            {commentCount !== undefined && commentCount > 0 && (
              <span className="font-medium tabular-nums">{commentCount}</span>
            )}
          </button>
          <button
            type="button"
            onClick={() => {
              setExpanded(false);
              setShowComments(false);
            }}
            aria-label="Collapse interactions"
            className="ml-auto inline-flex items-center justify-center rounded-full p-1.5 text-foreground/30 transition-colors hover:bg-black/[0.08] hover:text-foreground/60 dark:hover:bg-white/[0.08]"
          >
            <ChevronUp className="size-4" />
          </button>
        </div>
      </div>

      {manageSlot && <div className="border-t border-black/10 pt-2 dark:border-white/10">{manageSlot}</div>}

      {showComments && (
        <div className="border-t border-black/10 pt-2 dark:border-white/10">
          <WishCommentsList wishId={wishId} currentUserId={currentUserId} onCountChange={setCommentCount} />
        </div>
      )}
    </div>
  );
}

// ─── My wishes ───────────────────────────────────────────────────────────────

const fetchWishes = async () => {
  const res = await apiClient.api.wishes.$get();
  if (!res.ok) throw new Error("Couldn't load wishes");
  return res.json();
};

export function WishesContent({ currentUserId }: { currentUserId: string }) {
  const query = useQuery({
    queryKey: wishesQueryKey(),
    queryFn: fetchWishes,
    staleTime: HYDRATED_STALE_TIME,
  });

  const [showCreate, setShowCreate] = useState(false);
  const [recentWishId, setRecentWishId] = useState<string | null>(null);

  const wishes = query.data?.wishes ?? [];
  const currentWishes = wishes.filter((w) => w.status === "active");
  const pastWishes = wishes.filter((w) => w.status !== "active");
  const activeCount = currentWishes.length;
  const atLimit = !query.isPending && activeCount >= 30;
  const nearLimit = !query.isPending && activeCount >= 25 && !atLimit;

  const handleNewWish = (id: string) => {
    setShowCreate(false);
    setRecentWishId(id);
    setTimeout(() => setRecentWishId(null), 900);
  };

  return (
    <div className="flex w-full flex-col">
      {/* Instruction area — renders immediately, before wishes load --------- */}
      <div className="flex min-h-[38vh] flex-col items-center justify-center gap-10 pb-8 text-center">
        <div className="flex flex-col items-center gap-3">
          <p style={emerge(0)} className="font-serif text-3xl leading-relaxed text-foreground/75 italic">
            Take a breath.
            <br />
            What wish would you like to make?
          </p>
          <div style={emerge(2)}>
            <Popover>
              <PopoverTrigger
                render={
                  <button
                    type="button"
                    aria-label="What is a wish?"
                    className="text-muted-foreground/60 transition-colors hover:text-muted-foreground"
                  />
                }
              >
                <CircleHelp className="size-5" />
              </PopoverTrigger>
              <PopoverContent side="bottom" className="w-80">
                <PopoverHeader>
                  <PopoverTitle>What is a wish?</PopoverTitle>
                </PopoverHeader>
                <PopoverDescription>
                  A wish is a pull towards an outcome — a desire for things to be a certain way. It&apos;s the felt
                  sense of wanting something to exist: for yourself, your relationships, or the world.
                </PopoverDescription>
              </PopoverContent>
            </Popover>
          </div>
        </div>

        <div style={emerge(5)}>
          {atLimit ? (
            <div className="max-w-sm rounded-xl border border-amber-300 bg-amber-50/60 px-6 py-5 text-sm dark:border-amber-700 dark:bg-amber-950/20">
              <p className="font-medium text-amber-900 dark:text-amber-200">You&apos;ve reached your 30-wish limit.</p>
              <p className="mt-1 text-amber-800 dark:text-amber-300">
                Take some time to look back at what you&apos;ve wished for. Fulfil, archive, or simply sit with them
                before making new ones.
              </p>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3">
              {nearLimit && (
                <p className="text-sm text-muted-foreground">
                  {30 - activeCount} wish{30 - activeCount !== 1 ? "es" : ""} remaining before the limit — consider
                  looking back at your existing ones.
                </p>
              )}
              <Button
                type="button"
                variant="primary"
                className="px-10"
                onClick={() => setShowCreate(true)}
                disabled={showCreate || query.isPending}
              >
                Make a Wish
              </Button>
            </div>
          )}
        </div>
      </div>

      {showCreate && (
        <div className="mx-auto w-full max-w-lg">
          <CreateWishForm onDone={handleNewWish} />
        </div>
      )}

      {/* Current wishes ---------------------------------------------------- */}
      <section className="flex flex-col gap-4 pt-2" aria-labelledby="current-wishes-heading">
        <h2 id="current-wishes-heading" className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Current Wishes
        </h2>
        {query.isPending ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : query.isError ? (
          <p role="alert" className="text-sm text-destructive">
            Couldn&apos;t load your wishes.
          </p>
        ) : currentWishes.length === 0 ? (
          <p className="text-sm text-muted-foreground">No wishes yet. Make one!</p>
        ) : (
          <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
            {currentWishes.map((wish, i) => (
              <WishItem
                key={wish.id}
                wish={wish}
                currentUserId={currentUserId}
                isRecent={wish.id === recentWishId}
                index={i}
                onStatusChange={(id) => {
                  setRecentWishId(id);
                  setTimeout(() => setRecentWishId(null), 900);
                }}
              />
            ))}
          </ul>
        )}
      </section>

      {!query.isPending && !query.isError && pastWishes.length > 0 && (
        <section className="flex flex-col gap-4 pt-8" aria-labelledby="past-wishes-heading">
          <h2 id="past-wishes-heading" className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Past / Fulfilled Wishes
          </h2>
          <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
            {pastWishes.map((wish, i) => (
              <WishItem
                key={wish.id}
                wish={wish}
                currentUserId={currentUserId}
                isRecent={wish.id === recentWishId}
                index={i}
                onStatusChange={(id) => {
                  setRecentWishId(id);
                  setTimeout(() => setRecentWishId(null), 900);
                }}
              />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function CreateWishForm({ onDone }: { onDone: (newWishId: string) => void }) {
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
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: wishesQueryKey() });
      onDone(data.wish.id);
    },
  });

  return (
    <form
      className="mb-8 flex flex-col gap-3 rounded-xl border border-border bg-muted/20 p-5 shadow-sm"
      style={{ animation: "wish-in 0.4s ease-out both" }}
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
        <Button type="button" variant="ghost" disabled={createMutation.isPending} onClick={() => onDone("")}>
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

function WishItem({
  wish,
  currentUserId,
  isRecent,
  onStatusChange,
  index = 0,
}: {
  wish: Wish;
  currentUserId: string;
  isRecent: boolean;
  onStatusChange: (id: string) => void;
  index?: number;
}) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [leaving, setLeaving] = useState(false);

  const triggerStatus = (status: "active" | "archived" | "fulfilled") => {
    setLeaving(true);
    setTimeout(() => {
      statusMutation.mutate(status);
    }, 280);
  };

  const statusMutation = useMutation({
    mutationFn: async (status: "active" | "archived" | "fulfilled") => {
      const res = await apiClient.api.wishes[":id"].$patch({
        param: { id: wish.id },
        json: { status },
      });
      if (!res.ok) throw new Error("Couldn't update wish");
    },
    onSuccess: () => {
      onStatusChange(wish.id);
      return queryClient.invalidateQueries({ queryKey: wishesQueryKey() });
    },
    onSettled: () => setLeaving(false),
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const res = await apiClient.api.wishes[":id"].$delete({ param: { id: wish.id } });
      if (!res.ok) throw new Error("Couldn't delete wish");
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: wishesQueryKey() }),
  });

  const busy = statusMutation.isPending || deleteMutation.isPending;
  const reopenLabel = wish.status === "fulfilled" ? "Unfulfill" : "Reopen";

  const palette: TanzakuPalette =
    wish.status === "archived"
      ? { bg: "bg-[oklch(0.93_0.004_250)] dark:bg-[oklch(0.32_0.012_80)]", text: "text-foreground" }
      : wishPalette(wish.id);

  const animStyle: CSSProperties = leaving
    ? { animation: "wish-out 0.28s ease-out both" }
    : isRecent
      ? { animation: "wish-in 0.5s ease-out both" }
      : emerge(index);

  const manageActions = (
    <div className="flex flex-wrap gap-1.5">
      {wish.status === "active" ? (
        <>
          <Button type="button" variant="ghost" size="xs" disabled={busy} onClick={() => setEditing(true)}>
            Edit
          </Button>
          <Button type="button" variant="ghost" size="xs" disabled={busy} onClick={() => triggerStatus("fulfilled")}>
            {statusMutation.variables === "fulfilled" && statusMutation.isPending ? "Saving…" : "Fulfill"}
          </Button>
          <Button type="button" variant="ghost" size="xs" disabled={busy} onClick={() => triggerStatus("archived")}>
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
          <Button type="button" variant="ghost" size="xs" disabled={busy} onClick={() => triggerStatus("active")}>
            {statusMutation.isPending ? "Saving…" : reopenLabel}
          </Button>
          {wish.status === "archived" && (
            <Button type="button" variant="ghost" size="xs" disabled={busy} onClick={() => triggerStatus("fulfilled")}>
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
      {(statusMutation.isError || deleteMutation.isError) && (
        <p role="alert" className="w-full text-sm text-destructive">
          {statusMutation.error?.message ?? deleteMutation.error?.message}
        </p>
      )}
    </div>
  );

  return (
    <li
      className={`relative flex min-h-[300px] flex-col rounded-xl border border-[#D8D4DE] px-5 pb-5 pt-12 shadow-sm transition-[opacity,transform] duration-300 dark:border-[#494858] ${palette.bg}`}
      style={animStyle}
    >
      {/* Ribbon string */}
      <div className="absolute left-1/2 top-0 h-6 w-px -translate-x-1/2 bg-border/70" aria-hidden="true" />
      {/* Hole */}
      <div
        className="absolute left-1/2 top-5 size-4 -translate-x-1/2 rounded-full border-2 border-border/50 bg-background/80"
        aria-hidden="true"
      />

      {editing ? (
        <EditWishForm wish={wish} onDone={() => setEditing(false)} />
      ) : (
        <>
          <div className={`flex flex-1 flex-col items-center gap-3 pb-3 text-center ${palette.text}`}>
            <span className="font-serif text-xl font-medium leading-snug">{wish.title}</span>
            {wish.description && <span className="text-sm leading-relaxed opacity-70">{wish.description}</span>}
            <div className="mt-auto flex flex-col items-center gap-1 pt-2">
              {wish.status === "fulfilled" && (
                <span className="inline-flex items-center rounded-full bg-emerald-200/70 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-300">
                  Fulfilled ✓
                </span>
              )}
              {wish.status === "archived" && (
                <span className="inline-flex items-center rounded-full bg-black/10 px-2 py-0.5 text-xs font-medium text-muted-foreground dark:bg-white/10">
                  Archived
                </span>
              )}
              <span className="text-xs opacity-50">
                <LocalTime iso={wish.createdAt as unknown as string} />
              </span>
            </div>
          </div>

          <InteractionStrip
            wishId={wish.id}
            currentUserId={currentUserId}
            isOwnWish={true}
            manageSlot={manageActions}
          />
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

// ─── Discover ────────────────────────────────────────────────────────────────

const fetchDiscover = async () => {
  const res = await apiClient.api.wishes.discover.$get();
  if (!res.ok) throw new Error("Couldn't load discover");
  return res.json();
};

function shuffle<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export function DiscoverContent({ currentUserId }: { currentUserId: string }) {
  const query = useQuery({
    queryKey: discoverWishesQueryKey(),
    queryFn: fetchDiscover,
    staleTime: HYDRATED_STALE_TIME,
  });

  const [spotlight, setSpotlight] = useState<DiscoverWish[] | null>(null);
  const [spotlightKey, setSpotlightKey] = useState(0);

  if (query.isPending) return <p className="text-sm text-muted-foreground">Finding wishes…</p>;
  if (query.isError)
    return (
      <p role="alert" className="text-sm text-destructive">
        Couldn&apos;t load wishes.
      </p>
    );

  const all = query.data.wishes;

  const handleSpotlight = () => {
    setSpotlight(shuffle(all).slice(0, 5));
    setSpotlightKey((k) => k + 1);
  };

  return (
    <div className="flex w-full flex-col gap-5">
      {/* Header bar -------------------------------------------------------- */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {all.length === 0
            ? "No active wishes from other members yet."
            : `${all.length} active wish${all.length !== 1 ? "es" : ""} from the community`}
        </p>
        {all.length > 5 && (
          <Button type="button" variant="secondary" size="sm" onClick={handleSpotlight}>
            {spotlight ? "Shuffle again" : "Show me random wishes"}
          </Button>
        )}
      </div>

      {/* Spotlight --------------------------------------------------------- */}
      {spotlight && spotlight.length > 0 && (
        <div
          key={spotlightKey}
          className="rounded-xl border border-primary/25 bg-primary/5 p-4 dark:border-primary/15 dark:bg-primary/8"
        >
          <p className="mb-3 text-xs font-medium uppercase tracking-widest text-primary/70">✨ Just for you</p>
          <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
            {spotlight.map((wish, i) => (
              <DiscoverWishCard
                key={wish.id}
                wish={wish}
                currentUserId={currentUserId}
                style={{
                  animation: "spotlight-pop 0.45s ease-out both",
                  animationDelay: `${i * 90}ms`,
                }}
              />
            ))}
          </ul>
        </div>
      )}

      {/* Full list --------------------------------------------------------- */}
      {all.length > 0 && (
        <>
          {spotlight && <p className="text-xs text-muted-foreground">All wishes ↓</p>}
          <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
            {all.map((wish, i) => (
              <DiscoverWishCard key={wish.id} wish={wish} currentUserId={currentUserId} index={i} />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function DiscoverWishCard({
  wish,
  currentUserId,
  style,
  index = 0,
}: {
  wish: DiscoverWish;
  currentUserId: string;
  style?: CSSProperties;
  index?: number;
}) {
  const initials = (wish.authorDisplayName ?? "?")
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  const palette = wishPalette(wish.id);

  return (
    <li
      className={`relative flex min-h-[300px] flex-col rounded-xl border border-[#D8D4DE] px-5 pb-5 pt-12 shadow-sm transition-shadow hover:shadow-md dark:border-[#494858] ${palette.bg}`}
      style={style ?? emerge(index)}
    >
      {/* Ribbon string */}
      <div className="absolute left-1/2 top-0 h-6 w-px -translate-x-1/2 bg-border/70" aria-hidden="true" />
      {/* Hole */}
      <div
        className="absolute left-1/2 top-5 size-4 -translate-x-1/2 rounded-full border-2 border-border/50 bg-background/80"
        aria-hidden="true"
      />

      {/* Wish content — centered */}
      <div className={`flex flex-1 flex-col items-center gap-3 pb-3 text-center ${palette.text}`}>
        <span className="font-serif text-xl font-medium leading-snug">{wish.title}</span>
        {wish.description && <span className="text-sm leading-relaxed opacity-70">{wish.description}</span>}
        <div className="mt-auto flex flex-col items-center gap-1 pt-2">
          <div className="flex items-center gap-1.5">
            <span className="inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-black/10 text-[10px] font-semibold dark:bg-white/10">
              {initials}
            </span>
            <Link
              href={`/members/${wish.authorSlug ?? wish.authorId}#wishes`}
              className="text-xs font-medium hover:underline"
            >
              {wish.authorDisplayName ?? "Member"}
            </Link>
          </div>
          <span className="text-xs opacity-50">
            <LocalTime iso={wish.createdAt as unknown as string} />
          </span>
        </div>
      </div>

      <InteractionStrip wishId={wish.id} currentUserId={currentUserId} isOwnWish={wish.authorId === currentUserId} />
    </li>
  );
}
