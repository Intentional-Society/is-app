"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";

import { apiClient } from "@/lib/api";

import { memberWishesQueryKey } from "../../wishes/query-keys";

const fetchMemberWishes = async (profileId: string) => {
  const res = await apiClient.api.members[":id"].wishes.$get({ param: { id: profileId } });
  if (!res.ok) throw new Error("Couldn't load wishes");
  return res.json();
};

export function MemberWishesList({ profileId, isOwnProfile }: { profileId: string; isOwnProfile: boolean }) {
  const query = useQuery({
    queryKey: memberWishesQueryKey(profileId),
    queryFn: () => fetchMemberWishes(profileId),
  });

  if (query.isPending || query.isError) return null;

  const { wishes } = query.data;

  if (wishes.length === 0 && !isOwnProfile) return null;

  return (
    <div className="flex w-full max-w-md flex-col gap-2">
      <div className="flex items-center justify-between">
        <h2 className="text-sm uppercase tracking-wide text-muted-foreground">Wishes</h2>
        {isOwnProfile && (
          <Link href="/wishes" className="text-xs text-muted-foreground underline hover:text-foreground">
            Create / manage wishes
          </Link>
        )}
      </div>
      {wishes.length === 0 ? (
        <p className="font-serif text-base">
          <span className="text-muted-foreground">No active wishes yet. </span>
          <Link href="/wishes" className="text-muted-foreground underline hover:text-foreground">
            Make one?
          </Link>
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {wishes.map((wish) => (
            <li key={wish.id} className="flex flex-col gap-0.5">
              <span className="font-serif text-base">{wish.title}</span>
              {wish.description && <span className="text-sm text-muted-foreground">{wish.description}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
