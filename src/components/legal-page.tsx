import type { Route } from "next";
import Link from "next/link";

import { AppWordmark } from "@/components/app-wordmark";
import { Markdown } from "@/components/markdown";

const LINK_CLASSNAME = "underline text-muted-foreground hover:text-foreground";

// Shared shell for the public policy pages (/terms, /privacy). They are
// reachable signed out — linked from /signup before the email is submitted —
// so they carry the wordmark the other logged-out pages use. The body is
// in-repo markdown rendered through <Markdown>; editing the wording is a
// deploy.
export function LegalPage({
  title,
  updatedAt,
  body,
  other,
}: {
  title: string;
  updatedAt: Date;
  body: string;
  /** The sibling policy, linked in the footer. */
  other: { href: Route; label: string };
}) {
  return (
    <main className="flex min-h-screen flex-col items-center gap-8 px-8 py-12">
      <AppWordmark asLink />
      <article className="flex w-full max-w-2xl flex-col gap-2">
        <h2 className="text-3xl font-semibold">{title}</h2>
        <p className="text-sm text-muted-foreground">
          Last updated{" "}
          <time dateTime={updatedAt.toISOString().slice(0, 10)}>
            {updatedAt.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" })}
          </time>
        </p>
        <Markdown className="mt-4">{body}</Markdown>
      </article>
      <p className="text-base text-muted-foreground">
        See also our{" "}
        <Link href={other.href} className={LINK_CLASSNAME}>
          {other.label}
        </Link>
        .
      </p>
    </main>
  );
}
