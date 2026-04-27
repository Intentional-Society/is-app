import Link from "next/link";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { getProfileForSelf, upsertProfile } from "@/server/profiles";

import { MeSmokeWidget } from "./me-smoke";

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
      <p className="max-w-md text-center text-gray-400">
        A community of people practicing relational growth together.
      </p>

      <div className="flex w-full max-w-sm flex-col gap-3">
        <Link
          href="/login"
          className="block rounded bg-gray-100 px-3 py-2 text-center text-sm font-medium text-gray-900"
        >
          Sign in
        </Link>
        <Link
          href="/signup"
          className="block rounded border border-gray-600 px-3 py-2 text-center text-sm font-medium text-gray-300"
        >
          Join with an invite code
        </Link>
      </div>

      <p className="max-w-sm text-center text-sm text-gray-500">
        Don&apos;t have an invite?{" "}
        <a
          href="https://www.intentionalsociety.org/get-involved#connection-calls"
          className="underline text-gray-400 hover:text-gray-200"
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
      <Link
        href="/invites"
        className="rounded border border-gray-600 px-4 py-2 text-sm font-medium hover:bg-gray-800"
      >
        Manage invites
      </Link>
      <form action={signOut}>
        <button
          type="submit"
          className="rounded border border-gray-600 px-3 py-2 text-sm"
        >
          Sign out
        </button>
      </form>
      <MeSmokeWidget />
    </main>
  );
}
