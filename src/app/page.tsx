import Link from "next/link";
import { redirect } from "next/navigation";

import { Button } from "@/components/ui/button";
import { loadMe } from "@/lib/api-server";

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

function LoggedInHome() {
  return (
    <main className="flex min-h-screen flex-col items-center gap-6 p-8">
      <div className="flex flex-col items-center gap-1">
        <h1 className="text-4xl font-bold">Intentional Society</h1>
        <p className="font-serif italic text-2xl text-muted-foreground">The IS Web App</p>
      </div>
      <Button render={<Link href="/profile" />}>My profile</Button>
      <Button render={<Link href="/members" />}>Member directory</Button>
      <Button render={<Link href="/invites" />}>Manage invites</Button>
      <Button render={<Link href="/programs" />}>Programs</Button>
    </main>
  );
}

export default async function Home() {
  const me = await loadMe();
  if (!me) {
    return <LoggedOutHome />;
  }

  // Incomplete-profile heuristic: bio null means the member has not
  // completed /welcome yet. bio is the one field the welcome form
  // always collects, so it's a reliable sentinel.
  if (me.profile && me.profile.bio === null) {
    redirect("/welcome");
  }

  return <LoggedInHome />;
}
