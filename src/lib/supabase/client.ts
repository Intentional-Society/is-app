import { createBrowserClient } from "@supabase/ssr";

import { supabasePublishableKey, supabaseUrl } from "./env";

export const createClient = () => createBrowserClient(supabaseUrl, supabasePublishableKey);
