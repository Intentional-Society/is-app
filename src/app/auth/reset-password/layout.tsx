import type { Metadata } from "next";

import { titleFor } from "@/lib/page-titles";

// page.tsx here is a client component, which can't export `metadata`.
// This server-component layout carries the title so the history entry
// for the new-password screen is distinct.
export const metadata: Metadata = { title: titleFor("/auth/reset-password") };

export default function ResetPasswordLayout({ children }: { children: React.ReactNode }) {
  return children;
}
