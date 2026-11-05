"use client";

import { useSyncExternalStore } from "react";

import { formatDate, formatDateTime } from "@/lib/format-date";

const noopSubscribe = () => () => {};

// Server and first-hydration render: a fixed locale and zone, so the server's
// HTML matches what the browser hydrates against whatever the browser's locale
// or time zone is (a mismatch is a hydration error).
const SERVER_OPTS: Intl.DateTimeFormatOptions = { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" };
const SERVER_TIME_OPTS: Intl.DateTimeFormatOptions = { ...SERVER_OPTS, hour: "numeric", minute: "2-digit" };

const formatForServer = (iso: string, withTime: boolean): string => {
  try {
    return new Date(iso).toLocaleString("en-US", withTime ? SERVER_TIME_OPTS : SERVER_OPTS);
  } catch {
    return iso;
  }
};

// A timestamp shown in the viewer's own locale and time zone. Safe to render on
// the server: the server HTML (and hydration) uses UTC, then useSyncExternalStore
// swaps in the viewer's local format right after hydration with no mismatch.
export function LocalTime({ iso, withTime = false }: { iso: string; withTime?: boolean }) {
  const text = useSyncExternalStore(
    noopSubscribe,
    () => (withTime ? formatDateTime(iso) : formatDate(iso)),
    () => formatForServer(iso, withTime),
  );
  return <time dateTime={iso}>{text}</time>;
}
