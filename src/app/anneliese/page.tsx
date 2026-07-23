import { getAnnelieseData, resolveRange, PRESETS } from "./data";
import StackedBarChart from "./StackedBarChart";

export const dynamic = "force-dynamic";
// Deliberately not in any nav/sitemap and not disallowed in robots.txt either
// (a Disallow would just draw attention to it) — reachable only by URL.
export const metadata = { robots: { index: false, follow: false } };

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}m ${rest}s`;
}

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - (days - 1));
  return d.toISOString().slice(0, 10);
}

export default async function AnnelieseePage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const params = await searchParams;
  const range = resolveRange(params);
  const stats = await getAnnelieseData(range);
  const exportEntries = Object.entries(stats.exportsByFormat).sort((a, b) => Number(b[1]) - Number(a[1]));
  const today = new Date().toISOString().slice(0, 10);

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
      <div style={{ maxWidth: 720, width: "100%" }}>
        <h1 style={{ fontSize: 28, marginBottom: 4 }}>anneliese</h1>
        <p style={{ opacity: 0.6, marginBottom: 32, fontSize: 14 }}>Fontane.Studio — mini analytics, no login required.</p>

        {!stats.ok && (
          <p style={{ color: "#5100ff", marginBottom: 24 }}>
            Storage isn&apos;t connected yet (Supabase env vars missing) — showing zeros.
          </p>
        )}

        {/* Date-range filter — one row, above everything it scopes. Presets
            first (a plain GET link each, so the whole page just re-renders
            server-side), custom range behind a small form. */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 8, fontSize: 13 }}>
          {PRESETS.map((preset) => {
            const presetFrom = isoDaysAgo(preset.days);
            const active = range.from === presetFrom && range.to === today;
            return (
              <a
                key={preset.id}
                href={`?from=${presetFrom}&to=${today}`}
                style={{
                  padding: "4px 10px",
                  borderRadius: 4,
                  textDecoration: "none",
                  color: "#1f1934",
                  background: active ? "#d8ff01" : "transparent",
                  border: "1px solid rgba(31,25,52,0.2)",
                }}
              >
                {preset.label}
              </a>
            );
          })}
        </div>
        <form style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 32, fontSize: 13 }}>
          <input type="date" name="from" defaultValue={range.from} max={today} style={{ font: "inherit" }} />
          <span style={{ opacity: 0.6 }}>to</span>
          <input type="date" name="to" defaultValue={range.to} max={today} style={{ font: "inherit" }} />
          <button type="submit" style={{ font: "inherit", padding: "4px 10px", cursor: "pointer" }}>
            go
          </button>
        </form>

        <div style={{ display: "grid", gap: 24, gridTemplateColumns: "repeat(3, 1fr)", marginBottom: 40 }}>
          <div>
            <div style={{ fontSize: 40 }}>{stats.totalVisits}</div>
            <div style={{ opacity: 0.6, fontSize: 14 }}>total visits (all time)</div>
          </div>
          <div>
            <div style={{ fontSize: 40 }}>{stats.avgVisitsPerDay}</div>
            <div style={{ opacity: 0.6, fontSize: 14 }}>avg. visitors / day</div>
          </div>
          <div>
            <div style={{ fontSize: 40 }}>{formatDuration(stats.avgSeconds)}</div>
            <div style={{ opacity: 0.6, fontSize: 14 }}>avg. time on site</div>
          </div>
        </div>

        <h2 style={{ fontSize: 16, marginBottom: 4, opacity: 0.6 }}>
          visitors per {stats.buckets.length && stats.buckets[0].label.length > 6 ? "month" : "day"}, by source
        </h2>
        <p style={{ marginBottom: 12, fontSize: 13, opacity: 0.6 }}>
          {stats.directCount} direct / {stats.referredCount} referred, {range.from} – {range.to}
        </p>
        <StackedBarChart buckets={stats.buckets} legend={stats.legend} />

        <h2 style={{ fontSize: 16, margin: "40px 0 12px", opacity: 0.6 }}>exports by format</h2>
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

        <h2 style={{ fontSize: 16, margin: "40px 0 12px", opacity: 0.6 }}>tools used</h2>
        {stats.toolsByUsage.length === 0 ? (
          <p style={{ opacity: 0.6 }}>no tool activity yet</p>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <tbody>
              {stats.toolsByUsage.map(([tool, count]) => (
                <tr key={tool} style={{ borderTop: "1px solid rgba(31,25,52,0.15)" }}>
                  <td style={{ padding: "8px 0" }}>{tool}</td>
                  <td style={{ padding: "8px 0", textAlign: "right" }}>{count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <h2 style={{ fontSize: 16, margin: "40px 0 12px", opacity: 0.6 }}>marketplace browse → download</h2>
        <p style={{ opacity: 0.6, fontSize: 13, marginBottom: 4 }}>
          {stats.marketplaceViews} views, {stats.marketplaceDownloads} downloads
          {stats.marketplaceViews > 0 && ` (${Math.round((stats.marketplaceDownloads / stats.marketplaceViews) * 100)}%)`}
        </p>
        <p style={{ opacity: 0.4, fontSize: 12 }}>aggregate ratio, not a per-visitor funnel</p>

        <h2 style={{ fontSize: 16, margin: "40px 0 12px", opacity: 0.6 }}>visitors by country, device, language</h2>
        <div style={{ display: "grid", gap: 24, gridTemplateColumns: "repeat(3, 1fr)" }}>
          {(
            [
              ["country", stats.topCountries],
              ["device", stats.topDevices],
              ["language", stats.topLanguages],
            ] as const
          ).map(([label, entries]) => (
            <div key={label}>
              <div style={{ opacity: 0.6, fontSize: 13, marginBottom: 8, textTransform: "capitalize" }}>{label}</div>
              {entries.length === 0 ? (
                <p style={{ opacity: 0.6, fontSize: 13 }}>no data yet</p>
              ) : (
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <tbody>
                    {entries.map(([value, count]) => (
                      <tr key={value} style={{ borderTop: "1px solid rgba(31,25,52,0.15)" }}>
                        <td style={{ padding: "6px 0", fontSize: 13 }}>{value}</td>
                        <td style={{ padding: "6px 0", textAlign: "right", fontSize: 13 }}>{count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
