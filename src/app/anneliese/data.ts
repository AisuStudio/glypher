import { getSupabase } from "@/lib/supabase";

// Categorical order is fixed per-slot, not re-derived per render: Direct is
// always the first slot/color, "Other" is always the last — only the middle
// three (the actual top referrer hosts for the selected range) vary. Colors
// are the dataviz skill's validated default categorical palette, checked
// against this page's cream surface (#eae8e0): all 5 pass lightness/chroma/
// CVD; aqua and yellow fall under the 3:1 contrast floor against this
// surface, which is why every segment also gets a direct label rather than
// relying on color alone (the skill's "relief rule").
const DIRECT_COLOR = "#2a78d6"; // blue
const OTHER_COLOR = "#4a3aa7"; // violet
const REFERRER_COLORS = ["#1baf7a", "#eda100", "#008300"]; // aqua, yellow, green
const MAX_NAMED_REFERRERS = REFERRER_COLORS.length;

export type SourceSlice = { label: string; count: number; color: string };
export type Bucket = { label: string; total: number; sources: SourceSlice[] };

export type DateRange = { from: string; to: string }; // ISO "YYYY-MM-DD", inclusive

export const PRESETS = [
  { id: "7d", label: "Last 7 days", days: 7 },
  { id: "30d", label: "Last 30 days", days: 30 },
  { id: "90d", label: "Last 90 days", days: 90 },
] as const;

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function resolveRange(searchParams: { from?: string; to?: string }): DateRange {
  const today = isoDate(new Date());
  if (searchParams.from && searchParams.to) {
    return { from: searchParams.from, to: searchParams.to };
  }
  const from = new Date();
  from.setUTCDate(from.getUTCDate() - 29); // "Last 30 days" is the default, inclusive of today
  return { from: isoDate(from), to: today };
}

function daysBetween(from: string, to: string): number {
  const ms = new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime();
  return Math.round(ms / 86_400_000) + 1;
}

// Traffic scoped to [from, to] (both inclusive, UTC calendar days) — every
// stat on the page reads from this one query so the numbers always agree
// with each other and with the chart, per the "filters scope everything
// below them" rule.
export async function getAnnelieseData(range: DateRange) {
  const empty = {
    visitorCount: 0,
    avgSeconds: 0,
    exportsByFormat: {} as Record<string, number>,
    directCount: 0,
    referredCount: 0,
    buckets: [] as Bucket[],
    legend: [] as { label: string; color: string }[],
    ok: false as const,
  };

  const supabase = getSupabase();
  if (!supabase) return empty;

  const fromTs = `${range.from}T00:00:00.000Z`;
  const toTs = `${range.to}T23:59:59.999Z`;

  try {
    const [{ data: pageviews }, { data: durations }, { data: exports }] = await Promise.all([
      supabase
        .from("fontane_events")
        .select("visitor_id, referrer, created_at")
        .eq("type", "pageview")
        .gte("created_at", fromTs)
        .lte("created_at", toTs),
      supabase.from("fontane_events").select("seconds").eq("type", "duration").gte("created_at", fromTs).lte("created_at", toTs),
      supabase.from("fontane_events").select("format").eq("type", "export").gte("created_at", fromTs).lte("created_at", toTs),
    ]);

    const rows = pageviews ?? [];
    const visitorCount = new Set(rows.map((r) => r.visitor_id)).size;
    const seconds = (durations ?? []).map((r) => r.seconds).filter((s): s is number => s != null);
    const avgSeconds = seconds.length ? Math.round(seconds.reduce((a, b) => a + b, 0) / seconds.length) : 0;
    const exportsByFormat: Record<string, number> = {};
    for (const row of exports ?? []) {
      if (!row.format) continue;
      exportsByFormat[row.format] = (exportsByFormat[row.format] ?? 0) + 1;
    }
    const directCount = rows.filter((r) => !r.referrer).length;
    const referredCount = rows.length - directCount;

    // Top N referrer hosts by total volume across the whole range — the
    // fixed set of "named" slices; everything else folds into "Other".
    const referrerTotals = new Map<string, number>();
    for (const r of rows) {
      if (!r.referrer) continue;
      referrerTotals.set(r.referrer, (referrerTotals.get(r.referrer) ?? 0) + 1);
    }
    const topReferrers = [...referrerTotals.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_NAMED_REFERRERS)
      .map(([host]) => host);

    const monthly = daysBetween(range.from, range.to) > 31;
    const bucketOf = (createdAt: string) => (monthly ? createdAt.slice(0, 7) : createdAt.slice(0, 10)); // "YYYY-MM" or "YYYY-MM-DD"
    const bucketLabel = (key: string) =>
      monthly
        ? new Date(`${key}-01T00:00:00Z`).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" })
        : new Date(`${key}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

    // Pre-seed every bucket in range (not just ones with data) so the chart
    // has no silent gaps.
    const bucketKeys: string[] = [];
    if (monthly) {
      const cursor = new Date(`${range.from.slice(0, 7)}-01T00:00:00Z`);
      const end = new Date(`${range.to.slice(0, 7)}-01T00:00:00Z`);
      while (cursor <= end) {
        bucketKeys.push(cursor.toISOString().slice(0, 7));
        cursor.setUTCMonth(cursor.getUTCMonth() + 1);
      }
    } else {
      const cursor = new Date(`${range.from}T00:00:00Z`);
      const end = new Date(`${range.to}T00:00:00Z`);
      while (cursor <= end) {
        bucketKeys.push(isoDate(cursor));
        cursor.setUTCDate(cursor.getUTCDate() + 1);
      }
    }

    const countsByBucket = new Map<string, Map<string, number>>(); // bucketKey -> sourceLabel -> count
    for (const r of rows) {
      const key = bucketOf(r.created_at);
      const source = !r.referrer ? "Direct" : topReferrers.includes(r.referrer) ? r.referrer : "Other";
      const bySource = countsByBucket.get(key) ?? new Map<string, number>();
      bySource.set(source, (bySource.get(source) ?? 0) + 1);
      countsByBucket.set(key, bySource);
    }

    const sourceOrder = ["Direct", ...topReferrers, "Other"];
    const colorFor = (source: string) =>
      source === "Direct" ? DIRECT_COLOR : source === "Other" ? OTHER_COLOR : REFERRER_COLORS[topReferrers.indexOf(source)];

    const buckets: Bucket[] = bucketKeys.map((key) => {
      const bySource = countsByBucket.get(key);
      const sources: SourceSlice[] = sourceOrder
        .map((label) => ({ label, count: bySource?.get(label) ?? 0, color: colorFor(label) }))
        .filter((s) => s.count > 0);
      return { label: bucketLabel(key), total: sources.reduce((sum, s) => sum + s.count, 0), sources };
    });

    const legend = sourceOrder
      .filter((label) => label === "Direct" || label === "Other" || topReferrers.includes(label))
      .filter((label) => buckets.some((b) => b.sources.some((s) => s.label === label)))
      .map((label) => ({ label, color: colorFor(label) }));

    return { visitorCount, avgSeconds, exportsByFormat, directCount, referredCount, buckets, legend, ok: true as const };
  } catch {
    return empty;
  }
}
