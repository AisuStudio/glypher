import { getSupabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";
// Deliberately not in any nav/sitemap and not disallowed in robots.txt either
// (a Disallow would just draw attention to it) — reachable only by URL.
export const metadata = { robots: { index: false, follow: false } };

// Client-side aggregation over raw rows — fine at this project's traffic
// scale (a few hundred/thousand rows). If that ever stops being true, move
// these three aggregates into a Postgres view/RPC instead of fetching rows.
async function getStats() {
  const supabase = getSupabase();
  if (!supabase) {
    return { visitorCount: 0, avgSeconds: 0, exportsByFormat: {} as Record<string, number>, ok: false as const };
  }

  try {
    const [{ data: pageviews }, { data: durations }, { data: exports }] = await Promise.all([
      supabase.from("fontane_events").select("visitor_id").eq("type", "pageview"),
      supabase.from("fontane_events").select("seconds").eq("type", "duration"),
      supabase.from("fontane_events").select("format").eq("type", "export"),
    ]);

    const visitorCount = new Set((pageviews ?? []).map((r) => r.visitor_id)).size;
    const seconds = (durations ?? []).map((r) => r.seconds).filter((s): s is number => s != null);
    const avgSeconds = seconds.length ? Math.round(seconds.reduce((a, b) => a + b, 0) / seconds.length) : 0;
    const exportsByFormat: Record<string, number> = {};
    for (const row of exports ?? []) {
      if (!row.format) continue;
      exportsByFormat[row.format] = (exportsByFormat[row.format] ?? 0) + 1;
    }

    return { visitorCount, avgSeconds, exportsByFormat, ok: true as const };
  } catch {
    return { visitorCount: 0, avgSeconds: 0, exportsByFormat: {} as Record<string, number>, ok: false as const };
  }
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}m ${rest}s`;
}

export default async function AnnelieseePage() {
  const stats = await getStats();
  const exportEntries = Object.entries(stats.exportsByFormat).sort((a, b) => Number(b[1]) - Number(a[1]));

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#eae8e0",
        color: "#1f1934",
        fontFamily: "monospace",
        padding: "48px 24px",
        display: "flex",
        justifyContent: "center",
      }}
    >
      <div style={{ maxWidth: 560, width: "100%" }}>
        <h1 style={{ fontSize: 28, marginBottom: 4 }}>anneliese</h1>
        <p style={{ opacity: 0.6, marginBottom: 40, fontSize: 14 }}>Fontane.Studio — mini analytics, no login required.</p>

        {!stats.ok && (
          <p style={{ color: "#5100ff", marginBottom: 24 }}>
            Storage isn&apos;t connected yet (Supabase env vars missing) — showing zeros.
          </p>
        )}

        <div style={{ display: "grid", gap: 24, gridTemplateColumns: "repeat(2, 1fr)", marginBottom: 40 }}>
          <div>
            <div style={{ fontSize: 40 }}>{stats.visitorCount}</div>
            <div style={{ opacity: 0.6, fontSize: 14 }}>unique visitors</div>
          </div>
          <div>
            <div style={{ fontSize: 40 }}>{formatDuration(stats.avgSeconds)}</div>
            <div style={{ opacity: 0.6, fontSize: 14 }}>avg. time on site</div>
          </div>
        </div>

        <h2 style={{ fontSize: 16, marginBottom: 12, opacity: 0.6 }}>exports by format</h2>
        {exportEntries.length === 0 ? (
          <p style={{ opacity: 0.6 }}>no exports yet</p>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <tbody>
              {exportEntries.map(([format, count]) => (
                <tr key={format} style={{ borderTop: "1px solid rgba(31,25,52,0.15)" }}>
                  <td style={{ padding: "8px 0" }}>{format}</td>
                  <td style={{ padding: "8px 0", textAlign: "right" }}>{count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
