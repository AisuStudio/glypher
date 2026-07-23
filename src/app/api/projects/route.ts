import { getSupabase } from "@/lib/supabase";
import { isValidBetaCode } from "@/lib/betaCode";

export const dynamic = "force-dynamic";

// List: just enough to render "My Cloud Projects" (name + when), never the
// full glyph/stroke data — that's only fetched per-project on Load, see
// api/projects/[id]/route.ts.
export async function GET(request: Request) {
  if (!isValidBetaCode(request)) {
    return Response.json({ error: "invalid code" }, { status: 401 });
  }
  const supabase = getSupabase();
  if (!supabase) {
    return Response.json({ error: "backend unavailable" }, { status: 503 });
  }

  const { data, error } = await supabase
    .from("fontane_projects")
    .select("id, name, updated_at")
    .order("updated_at", { ascending: false });
  if (error) {
    return Response.json({ error: "list failed" }, { status: 500 });
  }
  return Response.json({ projects: data });
}

// Save: `id` present = update that row's name/data in place ("Save"),
// absent = insert a new row ("Save As"). The client always sends the full
// ProjectFile (glyphs/strokes/metrics/settings) as `project` — same shape
// buildProjectFile() in src/lib/projectFile.ts produces for the local FFF
// download, just stored as jsonb instead of downloaded as a file.
export async function POST(request: Request) {
  if (!isValidBetaCode(request)) {
    return Response.json({ error: "invalid code" }, { status: 401 });
  }
  const supabase = getSupabase();
  if (!supabase) {
    return Response.json({ error: "backend unavailable" }, { status: 503 });
  }

  let body: { id?: number; name?: string; project?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid body" }, { status: 400 });
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) {
    return Response.json({ error: "missing name" }, { status: 400 });
  }
  if (!body.project || typeof body.project !== "object") {
    return Response.json({ error: "missing project data" }, { status: 400 });
  }

  if (typeof body.id === "number") {
    const { data, error } = await supabase
      .from("fontane_projects")
      .update({ name, data: body.project, updated_at: new Date().toISOString() })
      .eq("id", body.id)
      .select("id, name, updated_at")
      .maybeSingle();
    if (error || !data) {
      return Response.json({ error: "update failed" }, { status: 500 });
    }
    return Response.json({ project: data });
  }

  const { data, error } = await supabase
    .from("fontane_projects")
    .insert({ name, data: body.project })
    .select("id, name, updated_at")
    .single();
  if (error) {
    return Response.json({ error: "save failed" }, { status: 500 });
  }
  return Response.json({ project: data });
}
