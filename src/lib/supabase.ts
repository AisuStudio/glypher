import { createClient } from "@supabase/supabase-js";

// Server-only client, uses the service role key (bypasses RLS) — safe here
// because this module is only ever imported from Route Handlers / Server
// Components (api/track, anneliese), never sent to the browser. The client
// only ever talks to our own /api/track endpoint, never to Supabase
// directly, so no anon key is needed at all.
//
// Fontane.Studio's own dedicated Supabase project (RLS enabled, no policies
// — see supabase/*.sql), separate from CNSL's project.
//
// Returns null (instead of throwing) when the env vars aren't set yet, so
// callers can no-op gracefully before this is wired up in Vercel.
export function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}
