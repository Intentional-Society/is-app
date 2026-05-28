import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AppWordmark } from "@/components/app-wordmark";
import { Button } from "@/components/ui/button";
import { loadMe } from "@/lib/api-server";
import { welcomeEntryStep } from "@/lib/welcomeEntryStep";

// Public landing page — opt back in to indexing (root layout is noindex by default).
export const metadata: Metadata = { robots: { index: true, follow: true } };

function LoggedOutHome() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 p-8">
      <AppWordmark />
      <p className="w-full max-w-sm text-center text-base text-muted-foreground">
        This site is for network members. Don&apos;t have an invite?{" "}
        <a
          href="https://www.intentionalsociety.org/get-involved#connection-calls"
          className="underline text-muted-foreground hover:text-foreground"
        >
          Join a Connection Call
        </a>{" "}
        to introduce yourself! In the meantime,{" "}
        <a
          href="https://www.intentionalsociety.org/web"
          className="underline text-muted-foreground hover:text-foreground"
        >
          read more here
        </a>
        .
      </p>

      <div className="flex w-full max-w-sm flex-col gap-3">
        <Button className="w-full" render={<Link href="/signin" />}>
          Sign in
        </Button>
        <Button className="w-full" render={<Link href="/signup" />}>
          Join with an invite code
        </Button>
      </div>
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
        <h1 className="text-4xl font-bold">The IS Web App</h1>
        <p className="font-serif italic text-muted-foreground">{greeting}. What would you like to do?</p>
        <p className="mt-2 max-w-md text-center text-base text-muted-foreground">
          We&apos;re actively building across this app still, but please try everything here — especially setting up
          your Web connections! Send any feedback to{" "}
          <a
            href="mailto:devteam@mail.intentionalsociety.org"
            className="underline text-muted-foreground hover:text-foreground"
          >
            devteam@mail.intentionalsociety.org
          </a>
        </p>
      </div>

      <div className="grid w-full max-w-lg gap-4 sm:grid-cols-2">
        <NavCard href="/programs" title="Programs" description="Explore and join IS Web programs." />
        <NavCard href="/members" title="Member directory" description="Browse and find other members." />
        <NavCard href="/myweb" title="My web" description="Build your relational map by adding connections!" />
        <NavCard href="/profile" title="My profile" description="View and edit your profile information." />
        <NavCard
          href="/invites"
          title="Invite a friend"
          description="Generate an invite code to bring someone into the network."
        />
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

  // Gate: route members into the multi-step welcome flow until every
  // onboarding step is done — agreements, profile, then programs. This
  // includes pre-filled profiles from the CSV import; we want those
  // members to confirm their details. See docs/design-welcome.md.
  const welcomeStep = welcomeEntryStep(me.profile);
  if (welcomeStep) {
    redirect(`/welcome/${welcomeStep}`);
  }

  return <LoggedInHome displayName={me.profile?.displayName ?? null} />;
}
