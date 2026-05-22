import Link from "next/link";

// The logged-out app title + tagline, shown on the landing and auth pages.
// Logged-out pages have no nav header (SiteHeader renders null without a
// user), so pass `asLink` on pages other than home to turn the title into a
// link back to the landing page. Only the title links, not the tagline.
export function AppWordmark({ asLink = false }: { asLink?: boolean }) {
  return (
    <div className="flex flex-col items-center gap-1">
      {asLink ? (
        <Link href="/" className="rounded transition-opacity hover:opacity-80">
          <h1 className="text-4xl font-bold">The IS Web App</h1>
        </Link>
      ) : (
        <h1 className="text-4xl font-bold">The IS Web App</h1>
      )}
      <p className="text-center font-serif italic text-2xl text-muted-foreground">
        for the living web of <span className="whitespace-nowrap">Intentional Society</span>
      </p>
    </div>
  );
}
