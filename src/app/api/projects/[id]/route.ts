import { getSupabase } from "@/lib/supabase";
import { isValidBetaCode } from "@/lib/betaCode";

export const dynamic = "force-dynamic";

// Full project JSON — only fetched on an explicit Load, not part of the list.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isValidBetaCode(request)) {
    return Response.json({ error: "invalid code" }, { status: 401 });
  }
  const { id } = await params;
  const supabase = getSupabase();
  if (!supabase) {
    return Response.json({ error: "backend unavailable" }, { status: 503 });
  }

  const { data, error } = await supabase
    .from("fontane_projects")
    .select("id, name, data, updated_at")
    .eq("id", id)
    .maybeSingle();
  if (error || !data) {
    return Response.json({ error: "not found" }, { status: 404 });
  }
  return Response.json({ project: data });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isValidBetaCode(request)) {
    return Response.json({ error: "invalid code" }, { status: 401 });
  }
  const { id } = await params;
  const supabase = getSupabase();
  if (!supabase) {
    return Response.json({ error: "backend unavailable" }, { status: 503 });
  }

  const { error } = await supabase.from("fontane_projects").delete().eq("id", id);
  if (error) {
    return Response.json({ error: "delete failed" }, { status: 500 });
  }
  return Response.json({ ok: true });
}
