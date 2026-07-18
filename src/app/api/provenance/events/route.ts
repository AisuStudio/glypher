import { getSupabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const MAX_EVENTS_PER_REQUEST = 200;
// Deliberately not client-supplied — `created_at` uses the table's own
// `default now()`, so every row's timestamp is stamped by Postgres itself
// at insert time. This is the one thing a forged batch can't fake.
type IncomingEvent = {
  draftId?: unknown;
  authorId?: unknown;
  clientStrokeId?: unknown;
  context?: unknown;
  tool?: unknown;
  pointCount?: unknown;
  durationMs?: unknown;
  avgPressure?: unknown;
  pressureVariance?: unknown;
  bboxW?: unknown;
  bboxH?: unknown;
};

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function toRow(e: IncomingEvent) {
  if (typeof e.draftId !== "string" || !e.draftId) return null;
  if (typeof e.authorId !== "string" || !e.authorId) return null;
  return {
    draft_id: e.draftId,
    author_id: e.authorId,
    client_stroke_id: typeof e.clientStrokeId === "string" ? e.clientStrokeId : null,
    context: typeof e.context === "string" ? e.context : null,
    tool: typeof e.tool === "string" ? e.tool : null,
    point_count: isFiniteNumber(e.pointCount) ? Math.round(e.pointCount) : null,
    duration_ms: isFiniteNumber(e.durationMs) ? Math.round(e.durationMs) : null,
    avg_pressure: isFiniteNumber(e.avgPressure) ? e.avgPressure : null,
    pressure_variance: isFiniteNumber(e.pressureVariance) ? e.pressureVariance : null,
    bbox_w: isFiniteNumber(e.bboxW) ? e.bboxW : null,
    bbox_h: isFiniteNumber(e.bboxH) ? e.bboxH : null,
  };
}

// Best-effort, low-probability cleanup of the 60-day retention policy
// (Decisions §3 in the provenance plan) — no cron/scheduled-function
// infrastructure exists anywhere else in this repo, so this piggybacks on
// regular ingestion traffic instead. Only ever deletes events for drafts
// that never got published (no fontane_fonts row references them).
const CLEANUP_PROBABILITY = 0.05;
const RETENTION_DAYS = 60;

async function maybeCleanupOrphanedEvents(supabase: NonNullable<ReturnType<typeof getSupabase>>) {
  if (Math.random() > CLEANUP_PROBABILITY) return;
  try {
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const { data: published } = await supabase.from("fontane_fonts").select("draft_id").not("draft_id", "is", null);
    const publishedDraftIds = new Set((published ?? []).map((f) => f.draft_id));
    const { data: stale } = await supabase
      .from("fontane_provenance_events")
      .select("id, draft_id")
      .lt("created_at", cutoff)
      .limit(500);
    const staleIds = (stale ?? []).filter((row) => !publishedDraftIds.has(row.draft_id)).map((row) => row.id);
    if (staleIds.length > 0) {
      await supabase.from("fontane_provenance_events").delete().in("id", staleIds);
    }
  } catch {
    // best-effort — never let cleanup break ingestion
  }
}

export async function POST(request: Request) {
  const supabase = getSupabase();
  if (!supabase) {
    return new Response(null, { status: 204 });
  }

  let body: { events?: unknown };
  try {
    body = await request.json();
  } catch {
    return new Response(null, { status: 204 });
  }

  const events = Array.isArray(body.events) ? body.events.slice(0, MAX_EVENTS_PER_REQUEST) : [];
  const rows = events.map((e) => toRow(e as IncomingEvent)).filter((r): r is NonNullable<typeof r> => r !== null);

  if (rows.length > 0) {
    try {
      await supabase.from("fontane_provenance_events").insert(rows);
    } catch {
      // best-effort — a dropped batch just makes the eventual publish gate
      // slightly stricter, never surfaced as an error to the drawing UI
    }
  }

  await maybeCleanupOrphanedEvents(supabase);

  return new Response(null, { status: 204 });
}
