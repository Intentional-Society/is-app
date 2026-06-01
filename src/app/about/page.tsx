import type { Metadata } from "next";

import { BreadcrumbLink } from "@/components/breadcrumb-link";
import { requireUser } from "@/lib/api-server";
import { appVersion, changelog, formatChangelogDate } from "@/lib/changelog";

export const metadata: Metadata = { title: "About" };

export default async function AboutPage() {
  await requireUser();

  return (
    <main className="flex min-h-screen flex-col items-center gap-8 p-8">
      <div className="flex w-full max-w-2xl items-center justify-between">
        <h1 className="text-2xl font-bold">About</h1>
        <BreadcrumbLink fallback="/" />
      </div>

      <p className="flex w-full max-w-2xl items-center gap-2 text-sm text-muted-foreground">
        <span className="rounded-full border border-border bg-card px-2.5 py-1 font-mono text-xs text-card-foreground">
          v{appVersion.replaceAll("-", ".")}
        </span>
        <span className="font-serif italic">Updated {formatChangelogDate(appVersion)}</span>
      </p>

      <section className="flex w-full max-w-2xl flex-col gap-4">
        <h2 className="text-lg font-semibold">Changelog</h2>
        <ol className="rounded-xl border border-border bg-card">
          {changelog.map((entry) => (
            <li key={`${entry.date}-${entry.title}`} className="flex gap-4 border-t border-border p-5 first:border-t-0">
              <time dateTime={entry.date} className="w-24 shrink-0 pt-0.5 text-xs text-muted-foreground sm:w-28">
                {formatChangelogDate(entry.date)}
              </time>
              <div className="flex flex-col gap-1">
                <h3 className="text-base font-semibold text-card-foreground">{entry.title}</h3>
                <p className="text-sm text-muted-foreground">{entry.description}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

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
    </main>
  );
}
