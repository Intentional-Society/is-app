import Link from "next/link";
import { redirect } from "next/navigation";

import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/server";
import { getProfileForSelf, upsertProfile } from "@/server/profiles";

async function signOut() {
  "use server";
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

function LoggedOutHome() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 p-8">
      <h1 className="text-4xl font-bold">Intentional Society</h1>
      <p className="max-w-md text-center text-muted-foreground">
        A community of people practicing relational growth together.
      </p>

      <div className="flex w-full max-w-sm flex-col gap-3">
        <Button className="w-full" render={<Link href="/login" />}>
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

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return <LoggedOutHome />;
  }

  let profile = await getProfileForSelf(user.id);
  if (!profile) {
    // Self-heal in case 1d's callback upsert failed.
    await upsertProfile(user);
    profile = await getProfileForSelf(user.id);
  }

  // Incomplete-profile heuristic: bio null means the member has not
  // completed /welcome yet. bio is the one field the welcome form
  // always collects, so it's a reliable sentinel.
  if (profile && profile.bio === null) {
    redirect("/welcome");
  }

  return (
    <main className="flex min-h-screen flex-col items-center gap-6 p-8">
      <h1 className="text-4xl font-bold">Intentional Society</h1>
      <p className="text-sm">Signed in as {user.email}</p>
      <p className="text-sm">Display name: {profile?.displayName ?? "—"}</p>
      <Button render={<Link href="/profile" />}>
        My profile
      </Button>
      <Button render={<Link href="/invites" />}>
        Manage invites
      </Button>
      <form action={signOut}>
        <Button type="submit">
          Sign out
        </Button>
      </form>
    </main>
  );
}
