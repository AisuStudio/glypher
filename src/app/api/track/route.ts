import { redis } from "@/lib/kv";

export const dynamic = "force-dynamic";

type TrackBody =
  | { type: "pageview"; visitorId: string }
  | { type: "duration"; seconds: number }
  | { type: "export"; format: string };

// Fire-and-forget event intake for the /anneliese mini-analytics page. Every
// Redis call is wrapped so a not-yet-provisioned (or misconfigured) database
// just no-ops instead of breaking the beacon — the client never even reads
// this response (sendBeacon doesn't expose it), so there's nothing to
// meaningfully report back to it anyway.
export async function POST(request: Request) {
  let body: TrackBody;
  try {
    body = await request.json();
  } catch {
    return new Response(null, { status: 204 });
  }

  try {
    if (body.type === "pageview" && body.visitorId) {
      await redis.sadd("fontane:visitors", body.visitorId);
    } else if (body.type === "duration" && Number.isFinite(body.seconds)) {
      await redis.incrby("fontane:time_total_seconds", Math.round(body.seconds));
      await redis.incr("fontane:time_sessions");
    } else if (body.type === "export" && body.format) {
      await redis.hincrby("fontane:exports_by_format", body.format, 1);
    }
  } catch {
    // KV not provisioned yet, or a transient error — swallow, this is
    // best-effort telemetry, not something that should ever surface an error.
  }

  return new Response(null, { status: 204 });
}
