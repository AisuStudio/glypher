import { createHash } from "crypto";
import { ipAddress, geolocation } from "@vercel/functions";
import { getSupabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

type TrackBody =
  | { type: "pageview"; referrer?: string | null; page?: string; language?: string | null }
  | { type: "duration"; seconds: number }
  | { type: "export"; format: string }
  | { type: "tool_use"; tool: string };

// Coarse device category from User-Agent — the full string is never stored,
// only this one-of-three label. iPad's UA on recent iPadOS omits "Mobile"
// and can even omit "iPad" (reports as a Mac UA) — not worth chasing further
// precision for an aggregate stat, "desktop" is an acceptable fallback there.
function deviceCategory(userAgent: string): "mobile" | "tablet" | "desktop" {
  const ua = userAgent.toLowerCase();
  if (/ipad/.test(ua) || (/android/.test(ua) && !/mobile/.test(ua))) return "tablet";
  if (/mobi|iphone|android/.test(ua)) return "mobile";
  return "desktop";
}

// Comma-separated raw IPs (ANALYTICS_EXCLUDED_IPS in Vercel/.env.local) —
// e.g. your own, so testing/checking the live site doesn't skew the visitor
// count. Compared against the request's IP only in-memory, per request;
// never written anywhere, so this doesn't reintroduce the raw-IP storage the
// fingerprint below deliberately avoids.
const EXCLUDED_IPS = new Set(
  (process.env.ANALYTICS_EXCLUDED_IPS ?? "")
    .split(",")
    .map((ip) => ip.trim())
    .filter(Boolean)
);

// A same-day, non-reversible fingerprint from IP+User-Agent — used only to
// approximate "unique visitors" (SELECT DISTINCT over this value), never
// stored as, or convertible back to, the raw IP. Rotates at midnight UTC (the
// date is baked into the hash input), so the same person on two different
// days is deliberately uncounted as the same visitor — the tradeoff GDPR/
// ePrivacy compliance needs here, since nothing is ever stored on the
// visitor's own device (see src/lib/analytics.ts) and nothing server-side
// lets you go from this value back to who it was.
function dailyVisitorFingerprint(ip: string, userAgent: string): string {
  const today = new Date().toISOString().slice(0, 10);
  const salt = process.env.ANALYTICS_SALT ?? "fontane-analytics";
  return createHash("sha256").update(`${salt}:${today}:${ip}:${userAgent}`).digest("hex");
}

// Only the real production deployment (fontane.studio) may ever write a row
// — `next dev` and Vercel preview/branch deployments both fall through this
// unwritten. IP-based exclusion (below) only catches whatever IP a given
// local setup happens to present, which isn't reliable (a proxy in front of
// `next dev` can hand out a different IP per request) — gating on the
// deployment itself is the only check that can't be bypassed by network
// path. VERCEL_ENV is unset locally, so this also covers plain `next dev`.
const IS_PRODUCTION = process.env.VERCEL_ENV === "production";

// Fire-and-forget event intake for the /anneliese mini-analytics page. A
// missing Supabase config (env vars not set yet) just no-ops instead of
// breaking the beacon — the client never even reads this response
// (sendBeacon doesn't expose it), so there's nothing to report back anyway.
export async function POST(request: Request) {
  let body: TrackBody;
  try {
    body = await request.json();
  } catch {
    return new Response(null, { status: 204 });
  }

  if (!IS_PRODUCTION) {
    return new Response(null, { status: 204 });
  }

  const ip = ipAddress(request) ?? "unknown";
  if (EXCLUDED_IPS.has(ip)) {
    return new Response(null, { status: 204 });
  }

  const supabase = getSupabase();
  if (supabase) {
    try {
      if (body.type === "pageview") {
        const userAgent = request.headers.get("user-agent") ?? "unknown";
        await supabase.from("fontane_events").insert({
          type: "pageview",
          visitor_id: dailyVisitorFingerprint(ip, userAgent),
          referrer: body.referrer ?? null,
          page: typeof body.page === "string" ? body.page : "editor",
          language: typeof body.language === "string" ? body.language : null,
          country: geolocation(request).country ?? null,
          device: deviceCategory(userAgent),
        });
      } else if (body.type === "duration" && Number.isFinite(body.seconds)) {
        await supabase.from("fontane_events").insert({ type: "duration", seconds: Math.round(body.seconds) });
      } else if (body.type === "export" && body.format) {
        await supabase.from("fontane_events").insert({ type: "export", format: body.format });
      } else if (body.type === "tool_use" && body.tool) {
        // Reuses the `format` column — unused for this type, same
        // aggregate-count shape as exports-by-format (see fontane_events.sql).
        await supabase.from("fontane_events").insert({ type: "tool_use", format: body.tool });
      }
    } catch {
      // Supabase reachable but the query itself failed (bad table/policy) —
      // still best-effort telemetry, never surface an error to the client.
    }
  }

  return new Response(null, { status: 204 });
}
