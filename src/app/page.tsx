import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Button } from "@/components/ui/button";
import { loadMe } from "@/lib/api-server";

// Public landing page — opt back in to indexing (root layout is noindex by default).
export const metadata: Metadata = { robots: { index: true, follow: true } };

function LoggedOutHome() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 p-8">
      <div className="flex flex-col items-center gap-1">
        <h1 className="text-4xl font-bold">Intentional Society</h1>
        <p className="font-serif italic text-2xl text-muted-foreground">The IS Web App</p>
      </div>
      <p className="max-w-md text-center text-muted-foreground">
        A community of people practicing relational growth together.
      </p>

      <div className="flex w-full max-w-sm flex-col gap-3">
        <Button className="w-full" render={<Link href="/signin" />}>
          Sign in
        </Button>
        <Button className="w-full" render={<Link href="/signup" />}>
          Join with an invite code
        </Button>
      </div>

      <p className="max-w-sm text-center text-base text-muted-foreground">
        Don&apos;t have an invite?{" "}
        <a
          href="https://www.intentionalsociety.org/get-involved#connection-calls"
          className="underline text-muted-foreground hover:text-foreground"
          target="_blank"
          rel="noopener noreferrer"
        >
          Join a Connection Call
        </a>{" "}
        to meet the community and learn more.
      </p>
    </main>
  );
}

type NavCardProps = {
  href: React.ComponentProps<typeof Link>["href"];
  title: string;
  description: string;
};

function NavCard({ href, title, description }: NavCardProps) {
  return (
    <Link
      href={href}
      className="group flex flex-col gap-2 rounded-xl border border-border bg-card p-5 transition-all hover:border-primary/40 hover:bg-accent hover:shadow-sm"
    >
      <h2 className="text-lg font-semibold text-card-foreground group-hover:text-accent-foreground">{title}</h2>
      <p className="text-sm text-muted-foreground">{description}</p>
    </Link>
  );
}

function LoggedInHome({ displayName }: { displayName: string | null }) {
  const greeting = displayName ? `Welcome, ${displayName}` : "Welcome back";

  return (
    <main className="flex min-h-screen flex-col items-center gap-8 p-8 pt-12">
      <div className="flex flex-col items-center gap-2">
        <h1 className="text-3xl font-bold">{greeting}</h1>
        <p className="font-serif italic text-muted-foreground">What would you like to do?</p>
      </div>

      <div className="grid w-full max-w-lg gap-4 sm:grid-cols-2">
        <NavCard href="/myweb" title="My web" description="See your connections and relational map." />
        <NavCard href="/profile" title="My profile" description="View and edit your community profile." />
        <NavCard href="/members" title="Member directory" description="Browse and connect with other members." />
        <NavCard href="/programs" title="Programs" description="Explore and join community programs." />
        <NavCard href="/invites" title="Invite a friend" description="Generate invite codes for new members." />
      </div>
    </main>
  );
}

export default async function Home() {
  const me = await loadMe();
  if (!me) {
    return <LoggedOutHome />;
  }

  // Diagnostic for #149: log whether the redirect-to-/welcome gate
  // sees a profile and what bio is. Gated on x-debug-timing to keep
  // production logs uncluttered. Remove once #149 is resolved.
  if ((await headers()).get("x-debug-timing") === "1") {
    console.log(
      `[debug-149] home me.profile=${me.profile ? "present" : "null"} bio=${JSON.stringify(me.profile?.bio)}`,
    );
  }

  // Gate: redirect to /welcome until the member has saved their profile
  // at least once (lastUpdatedProfile set by PUT /me). This includes
  // pre-filled profiles from the CSV import — we want those members to
  // go through the welcome flow to confirm and update their details.
  if (me.profile && !me.profile.lastUpdatedProfile) {
    redirect("/welcome");
  }

  return <LoggedInHome displayName={me.profile?.displayName ?? null} />;
}
