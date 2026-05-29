"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { relationValueQueryKey } from "@/app/myweb/query-keys";
import type { RelatingTarget } from "@/app/myweb/relating-dialog";
import { RelatingDialog } from "@/app/myweb/relating-dialog";
import { apiClient } from "@/lib/api";
import { isRelationValue, RELATION_VALUE_LABELS } from "@/lib/relation-value";

type Props = {
  memberId: string;
  memberName: string | null;
};

export function MemberRelationControl({ memberId, memberName }: Props) {
  const [dialogTarget, setDialogTarget] = useState<RelatingTarget | null>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: relationValueQueryKey(memberId),
    queryFn: async () => {
      const res = await apiClient.api.relations.value[":relateeId"].$get({
        param: { relateeId: memberId },
      });
      if (!res.ok) throw new Error(`Failed to fetch relation: ${res.status}`);
      return res.json();
    },
  });

  const value = isRelationValue(data?.value) ? data.value : null;

  return (
    <>
      <div className="flex items-center gap-3">
        <span className="text-sm text-muted-foreground">
          {isLoading
            ? "Loading…"
            : isError
              ? "Couldn't load connection"
              : value !== null
                ? `Connected · ${RELATION_VALUE_LABELS[value].headline}`
                : "Not yet connected"}
        </span>
        <button
          type="button"
          onClick={() => setDialogTarget({ id: memberId, displayName: memberName, currentValue: value })}
          className="text-sm text-muted-foreground underline hover:no-underline"
        >
          {value !== null ? "Edit" : "Connect"}
        </button>
      </div>

      <RelatingDialog target={dialogTarget} onClose={() => setDialogTarget(null)} />
    </>
  );
}
