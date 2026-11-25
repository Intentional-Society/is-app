"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronUp, MessageCircle } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { LocalTime } from "@/components/local-time";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { apiClient } from "@/lib/api";
import type { WishComment } from "@/lib/api-types";

import { memberWishesQueryKey, wishCommentsQueryKey, wishReactionsQueryKey } from "../../wishes/query-keys";

const REACTIONS = [
  { key: "love", emoji: "❤️", label: "Love it!" },
  { key: "me_too", emoji: "🙌", label: "Me too!" },
  { key: "supportive", emoji: "🌟", label: "Supportive" },
  { key: "help", emoji: "🤝", label: "Let me help!" },
] as const;

type ReactionKey = (typeof REACTIONS)[number]["key"];

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

const TANZAKU_PALETTES = [
  { bg: "bg-[#E2D9F5] dark:bg-[#403453]", text: "text-[#34333D] dark:text-[#E5D8FA]" }, // Lilac
  { bg: "bg-[#F9DFE6] dark:bg-[#50343F]", text: "text-[#34333D] dark:text-[#F5D6E2]" }, // Blush
  { bg: "bg-[#D8E4FA] dark:bg-[#303F5C]", text: "text-[#34333D] dark:text-[#D7E3FF]" }, // Periwinkle
  { bg: "bg-[#FBEDBE] dark:bg-[#50462D]", text: "text-[#34333D] dark:text-[#F7E6B3]" }, // Sunlight
  { bg: "bg-[#D7EDDF] dark:bg-[#2D473E]", text: "text-[#34333D] dark:text-[#D0EFDF]" }, // Mint
] as const;

function wishPalette(id: string): (typeof TANZAKU_PALETTES)[number] {
  const hash = [...id].reduce((acc, c) => acc + c.charCodeAt(0), 0);
  return TANZAKU_PALETTES[hash % TANZAKU_PALETTES.length];
}

function InteractionStrip({
  wishId,
  currentUserId,
  isOwnWish,
}: {
  wishId: string;
  currentUserId: string;
  isOwnWish: boolean;
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

      {showComments && (
        <div className="border-t border-black/10 pt-2 dark:border-white/10">
          <WishCommentsList wishId={wishId} currentUserId={currentUserId} onCountChange={setCommentCount} />
        </div>
      )}
    </div>
  );
}

const fetchMemberWishes = async (profileId: string) => {
  const res = await apiClient.api.members[":id"].wishes.$get({ param: { id: profileId } });
  if (!res.ok) throw new Error("Couldn't load wishes");
  return res.json();
};

export function MemberWishesList({
  profileId,
  isOwnProfile,
  currentUserId,
}: {
  profileId: string;
  isOwnProfile: boolean;
  currentUserId: string;
}) {
  const query = useQuery({
    queryKey: memberWishesQueryKey(profileId),
    queryFn: () => fetchMemberWishes(profileId),
  });

  if (query.isPending || query.isError) return <div id="wishes" />;

  const { wishes } = query.data;

  return (
    <div id="wishes" className="flex w-full max-w-md flex-col gap-2">
      <div className="flex items-center justify-between">
        <h2 className="text-sm uppercase tracking-wide text-muted-foreground">Wishes</h2>
        {isOwnProfile && (
          <Link href="/wishes" className="text-xs text-muted-foreground underline hover:text-foreground">
            Create / manage wishes
          </Link>
        )}
      </div>
      {wishes.length === 0 ? (
        isOwnProfile ? (
          <p className="font-serif text-base">
            <span className="text-muted-foreground">No active wishes yet. </span>
            <Link href="/wishes" className="text-muted-foreground underline hover:text-foreground">
              Make one?
            </Link>
          </p>
        ) : (
          <p className="font-serif text-base text-muted-foreground">No wishes right now.</p>
        )
      ) : (
        <ul className="flex flex-col gap-3">
          {wishes.map((wish) => {
            const palette = wishPalette(wish.id);
            return (
              <li
                key={wish.id}
                className={`relative flex min-h-[240px] flex-col rounded-xl border border-[#D8D4DE] px-5 pb-5 pt-12 shadow-sm dark:border-[#494858] ${palette.bg}`}
              >
                {/* Ribbon string */}
                <div className="absolute left-1/2 top-0 h-6 w-px -translate-x-1/2 bg-border/70" aria-hidden="true" />
                {/* Hole */}
                <div
                  className="absolute left-1/2 top-5 size-4 -translate-x-1/2 rounded-full border-2 border-border/50 bg-background/80"
                  aria-hidden="true"
                />
                <div className={`flex flex-1 flex-col items-center gap-3 pb-3 text-center ${palette.text}`}>
                  <span className="font-serif text-lg font-medium leading-snug">{wish.title}</span>
                  {wish.description && <span className="text-sm leading-relaxed opacity-70">{wish.description}</span>}
                  <span className="mt-auto pt-2 text-xs opacity-50">
                    <LocalTime iso={wish.createdAt as unknown as string} />
                  </span>
                </div>
                <InteractionStrip wishId={wish.id} currentUserId={currentUserId} isOwnWish={isOwnProfile} />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
