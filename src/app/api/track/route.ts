import { getSupabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

type TrackBody =
  | { type: "pageview"; visitorId: string; referrer?: string | null }
  | { type: "duration"; seconds: number }
  | { type: "export"; format: string };

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

  const supabase = getSupabase();
  if (supabase) {
    try {
      if (body.type === "pageview" && body.visitorId) {
        await supabase
          .from("fontane_events")
          .insert({ type: "pageview", visitor_id: body.visitorId, referrer: body.referrer ?? null });
      } else if (body.type === "duration" && Number.isFinite(body.seconds)) {
        await supabase.from("fontane_events").insert({ type: "duration", seconds: Math.round(body.seconds) });
      } else if (body.type === "export" && body.format) {
        await supabase.from("fontane_events").insert({ type: "export", format: body.format });
      }
    } catch {
      // Supabase reachable but the query itself failed (bad table/policy) —
      // still best-effort telemetry, never surface an error to the client.
    }
  }

  return new Response(null, { status: 204 });
}
