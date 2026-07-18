import { getSupabase } from "@/lib/supabase";
import { slugify } from "@/lib/slug";

export const dynamic = "force-dynamic";

// Adds "https://" when a URL has no scheme at all, so a homepage typed as
// "example.com" still renders as a working link rather than a relative one.
function normalizeAuthorUrl(raw: string): string {
  return /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
}

// Provenance publish gate — see the provenance plan's Decisions §2. A
// deliberately loose starting point (bias toward not blocking real small
// fonts): tune from here once real usage exists.
const MIN_PROVENANCE_EVENTS = 15;
const MIN_PROVENANCE_SPAN_MS = 3 * 60 * 1000; // 3 minutes, first event to last
const PROVENANCE_SPREAD_BUCKETS = 3; // events must land in all 3 thirds of the span, not just clustered at the ends

// A font is only publishable if the backend holds a real, server-timestamped
// record of it being drawn over time — not just this request's file. Checks
// count, real elapsed time span, and spread (catches "one old dummy event +
// a scripted burst just before publish" gaming the count/span thresholds
// alone). created_at is stamped by Postgres on insert (api/provenance/
// events/route.ts), never client-supplied, so this can't be backdated.
async function checkProvenance(
  supabase: NonNullable<ReturnType<typeof getSupabase>>,
  draftId: string,
  authorId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data: events, error } = await supabase
    .from("fontane_provenance_events")
    .select("created_at")
    .eq("draft_id", draftId)
    .eq("author_id", authorId)
    .order("created_at", { ascending: true });

  if (error) return { ok: false, error: "provenance lookup failed" };
  if (!events || events.length < MIN_PROVENANCE_EVENTS) {
    return { ok: false, error: "This font doesn't have enough recorded drawing history to publish yet — keep drawing directly in Fontane." };
  }

  const first = new Date(events[0].created_at).getTime();
  const last = new Date(events[events.length - 1].created_at).getTime();
  const spanMs = last - first;
  if (spanMs < MIN_PROVENANCE_SPAN_MS) {
    return { ok: false, error: "This font's drawing history doesn't span enough real time to publish yet." };
  }

  const bucketMs = spanMs / PROVENANCE_SPREAD_BUCKETS;
  const buckets = new Set<number>();
  for (const e of events) {
    const t = new Date(e.created_at).getTime();
    buckets.add(Math.min(PROVENANCE_SPREAD_BUCKETS - 1, Math.floor((t - first) / bucketMs)));
  }
  if (buckets.size < PROVENANCE_SPREAD_BUCKETS) {
    return { ok: false, error: "This font's drawing history looks too clustered to publish yet — keep drawing directly in Fontane." };
  }

  return { ok: true };
}

// Publishing is anonymous and permanent by design (no accounts) — see
// the Marketplace plan. This route is the only writer to fontane_fonts
// and the "fonts" Storage bucket; the client-side check-slug call is just
// UX feedback, so the slug uniqueness is re-verified here for real.
export async function POST(request: Request) {
  const supabase = getSupabase();
  if (!supabase) {
    return Response.json({ error: "backend unavailable" }, { status: 503 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: "invalid form data" }, { status: 400 });
  }

  const font = form.get("font");
  const name = form.get("name");
  const glyphCount = form.get("glyphCount");
  const licenseAccepted = form.get("licenseAccepted");
  const authorNameRaw = form.get("authorName");
  const authorUrlRaw = form.get("authorUrl");
  const draftIdRaw = form.get("draftId");
  const authorIdRaw = form.get("authorId");

  if (!(font instanceof Blob) || font.size === 0) {
    return Response.json({ error: "missing font file" }, { status: 400 });
  }
  if (typeof name !== "string" || !name.trim()) {
    return Response.json({ error: "missing name" }, { status: 400 });
  }
  if (licenseAccepted !== "true") {
    return Response.json({ error: "license not accepted" }, { status: 400 });
  }
  if (typeof draftIdRaw !== "string" || !draftIdRaw || typeof authorIdRaw !== "string" || !authorIdRaw) {
    return Response.json({ error: "missing provenance identifiers" }, { status: 400 });
  }

  const provenance = await checkProvenance(supabase, draftIdRaw, authorIdRaw);
  if (!provenance.ok) {
    return Response.json({ error: provenance.error }, { status: 403 });
  }

  const slug = slugify(name);
  if (!slug) {
    return Response.json({ error: "invalid name" }, { status: 400 });
  }

  const authorName = typeof authorNameRaw === "string" && authorNameRaw.trim() ? authorNameRaw.trim() : null;
  const authorUrl =
    typeof authorUrlRaw === "string" && authorUrlRaw.trim() ? normalizeAuthorUrl(authorUrlRaw.trim()) : null;

  const { data: existing, error: lookupError } = await supabase
    .from("fontane_fonts")
    .select("id")
    .eq("slug", slug)
    .maybeSingle();
  if (lookupError) {
    return Response.json({ error: "lookup failed" }, { status: 500 });
  }
  if (existing) {
    return Response.json({ error: "name already taken" }, { status: 409 });
  }

  const { error: uploadError } = await supabase.storage.from("fonts").upload(`${slug}.otf`, font, {
    contentType: "font/otf",
    upsert: false,
  });
  if (uploadError) {
    return Response.json({ error: "upload failed" }, { status: 500 });
  }

  const { error: insertError } = await supabase.from("fontane_fonts").insert({
    slug,
    display_name: name.trim(),
    glyph_count: typeof glyphCount === "string" ? parseInt(glyphCount, 10) || 0 : 0,
    file_size: font.size,
    license_accepted_at: new Date().toISOString(),
    author_name: authorName,
    author_url: authorUrl,
    draft_id: draftIdRaw,
    author_id: authorIdRaw,
  });
  if (insertError) {
    // Roll back the upload so a failed publish doesn't leave an orphaned file.
    await supabase.storage.from("fonts").remove([`${slug}.otf`]);
    return Response.json({ error: "publish failed" }, { status: 500 });
  }

  return Response.json({ slug });
}
