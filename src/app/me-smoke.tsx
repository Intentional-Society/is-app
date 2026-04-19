"use client";

import { useEffect, useState } from "react";

import { apiClient } from "@/lib/api";

// Phase 1 smoke widget: proves the authed RPC wire works from the
// browser end-to-end. Remove in Phase 2 when real widgets replace it.
export function MeSmokeWidget() {
  const [status, setStatus] = useState("authed RPC: checking…");

  useEffect(() => {
    apiClient.api.me
      .$get()
      .then(async (res) => {
        if (!res.ok) {
          setStatus(`authed RPC: failed (${res.status})`);
          return;
        }
        const data = await res.json();
        setStatus(`authed RPC: ok (${String(data.id).slice(0, 8)}…)`);
      })
      .catch(() => setStatus("authed RPC: failed"));
  }, []);

  return <p className="text-xs text-gray-400">{status}</p>;
}
