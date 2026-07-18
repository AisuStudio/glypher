import { ipAddress } from "@vercel/functions";
import { getSupabase } from "@/lib/supabase";
import { publicFontUrl } from "@/lib/marketplace";

export const dynamic = "force-dynamic";

// Same two gates api/track/route.ts uses for every event it writes — kept
// local here (not imported from that file) since it's owned by a separate,
// concurrently active session; duplicating ~10 lines is cheaper than the
// merge-collision risk of both sessions editing the same file.
const IS_PRODUCTION = process.env.VERCEL_ENV === "production";
const EXCLUDED_IPS = new Set(
  (process.env.ANALYTICS_EXCLUDED_IPS ?? "")
    .split(",")
    .map((ip) => ip.trim())
    .filter(Boolean)
);

// Download links point here (not straight at the public Storage URL) so the
// download_count can be tracked, then redirects to the actual file. Count
// updates aren't atomic (read-then-write) — acceptable for an MVP counter,
// not billing-grade.
//
// ?notrack (same param analytics.ts's client-side opt-out uses, but this
// route is server-only so it reads its own request URL instead) skips BOTH
// the public download_count increment and the fontane_events insert — a
// no-side-effects download, for the font's own publisher testing their own
// listing. The overview page appends this automatically when the page
// itself was loaded with ?notrack.
export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const notrack = new URL(request.url).searchParams.has("notrack");

  const supabase = getSupabase();
  if (!supabase) {
    return Response.json({ error: "backend unavailable" }, { status: 503 });
  }

  const { data: font, error } = await supabase
    .from("fontane_fonts")
    .select("id, download_count")
    .eq("slug", slug)
    .maybeSingle();
  if (error || !font) {
    return Response.json({ error: "not found" }, { status: 404 });
  }

  if (!notrack) {
    await supabase.from("fontane_fonts").update({ download_count: font.download_count + 1 }).eq("id", font.id);

    // Also lands in the general fontane_events aggregate (same table the main
    // app's exports/pageviews use) so it shows up in /anneliese's existing
    // "exports by format" breakdown without that page needing any changes.
    if (IS_PRODUCTION) {
      const ip = ipAddress(request) ?? "unknown";
      if (!EXCLUDED_IPS.has(ip)) {
        try {
          await supabase.from("fontane_events").insert({ type: "export", format: "marketplace-download" });
        } catch {
          // best-effort telemetry, never block the actual download/redirect
        }
      }
    }
  }

  return Response.redirect(publicFontUrl(slug), 302);
}
