import { config } from "dotenv";

config({ path: ".env.local" });

// Functional tests insert and delete rows directly, so they run only
// against a local Supabase: CI's in-runner stack, a dev stack, or a
// lane. Nothing runs Vitest against a remote one. Reports the host
// only: the URLs carry creds.
for (const name of ["DATABASE_URL", "NEXT_PUBLIC_SUPABASE_URL"]) {
  let host: string;
  try {
    host = new URL(process.env[name] ?? "").hostname;
  } catch {
    host = "(unset or unparseable)";
  }
  if (host !== "127.0.0.1" && host !== "localhost") {
    throw new Error(`Functional tests refuse to run: ${name} points at ${host}, not a local Supabase.`);
  }
}
