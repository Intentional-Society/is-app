import type { Metadata } from "next";

import { PageHeader } from "@/components/page-header";
import { requireUser } from "@/lib/api-server";
import { appVersion, changelog, formatChangelogDate } from "@/lib/changelog";
import { titleFor } from "@/lib/page-titles";

import { CollapsibleSection } from "./collapsible-section";
import { SystemMetrics } from "./system-metrics";

export const metadata: Metadata = { title: titleFor("/about") };

export default async function AboutPage() {
  await requireUser();

  return (
    <main className="flex min-h-screen flex-col items-center gap-8 px-8 pb-8 pt-3">
      <PageHeader title="About" />

      <CollapsibleSection title="System Metrics">
        <SystemMetrics />
      </CollapsibleSection>

      <CollapsibleSection
        title="Changelog"
        accessory={
          <span className="rounded-full border border-border bg-card px-2.5 py-1 font-mono text-xs text-card-foreground">
            v{appVersion.replaceAll("-", ".")}
          </span>
        }
      >
        <p className="mb-4 text-sm text-muted-foreground">
          This is a running list, newest first, of significant updates made to this app.
        </p>
        <ol className="flex flex-col">
          {changelog.map((entry) => (
            <li
              key={`${entry.date}-${entry.title}`}
              className="flex gap-4 border-t border-border py-2.5 first:border-t-0 first:pt-0"
            >
              <time dateTime={entry.date} className="w-24 shrink-0 text-xs text-muted-foreground sm:w-28">
                {formatChangelogDate(entry.date)}
              </time>
              <div className="flex flex-col gap-0.5">
                <h3 className="text-sm font-semibold text-card-foreground">{entry.title}</h3>
                <p className="text-sm text-muted-foreground">{entry.description}</p>
              </div>
            </li>
          ))}
        </ol>
      </CollapsibleSection>

      <section className="w-full max-w-2xl">
        <h2 className="text-lg font-semibold">The team</h2>
        <p className="mt-2 text-base text-muted-foreground">
          This app is built by the IS Dev Team: James, Benji, Ola, Alexis, and Blake. The code is open — read it at{" "}
          <a
            href="https://github.com/Intentional-Society/is-app"
            target="_blank"
            rel="noopener noreferrer"
            className="underline text-muted-foreground hover:text-foreground"
          >
            github.com/Intentional-Society/is-app
          </a>
          . Want to help build it? Email{" "}
          <a
            href="mailto:devteam@mail.intentionalsociety.org"
            className="underline text-muted-foreground hover:text-foreground"
          >
            devteam@mail.intentionalsociety.org
          </a>
          .
        </p>
      </section>

      <section className="w-full max-w-2xl">
        <h2 className="text-lg font-semibold">Browser support</h2>
        <p className="mt-2 text-base text-muted-foreground">
          This app is built to the{" "}
          <a
            href="https://web.dev/baseline"
            rel="noopener noreferrer"
            className="underline text-muted-foreground hover:text-foreground"
          >
            Web Platform Baseline
          </a>{" "}
          "Widely Available" standard: we rely on a web feature only when every major browser (Chrome, Edge, Firefox,
          Safari) has supported it for at least 30 months. Older browsers are supported on a best-effort basis,
          prioritizing functionality over visuals. Browsers too old to run the app at all (roughly pre-2020) see an
          update notice instead.
        </p>
      </section>
    </main>
  );
}
