// Server-only check for the shared cloud-projects betacode (see
// supabase/fontane_projects.sql's header for why there's no per-user auth).
// Checked here, never in client code, so the real value never reaches the
// browser bundle — the client only ever holds whatever the user typed in.
export function isValidBetaCode(request: Request): boolean {
  const expected = process.env.FONTANE_BETA_CODE;
  if (!expected) return false;
  return request.headers.get("x-fontane-code") === expected;
}
