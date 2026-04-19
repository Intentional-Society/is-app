import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { db } from "@/server/db";
import { upsertProfile } from "@/server/profiles";
import { profiles } from "@/server/schema";

import { MeSmokeWidget } from "./me-smoke";

async function signOut() {
  "use server";
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login");
  }

  const readProfile = () =>
    db.select().from(profiles).where(eq(profiles.id, user.id));

  let [profile] = await readProfile();
  if (!profile) {
    // Self-heal in case 1d's callback upsert failed.
    await upsertProfile(user);
    [profile] = await readProfile();
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-8">
      <h1 className="text-4xl font-bold">Intentional Society</h1>
      <p className="text-sm">Signed in as {user.email}</p>
      <p className="text-sm">Display name: {profile?.displayName ?? "—"}</p>
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
