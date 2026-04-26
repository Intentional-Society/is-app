import { createClient } from "@/lib/supabase/server";

import { SiteHeaderClient } from "./site-header-client";

export async function SiteHeader() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  return <SiteHeaderClient />;
}
