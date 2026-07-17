"use client";

import { useState } from "react";
import type { Bucket } from "./data";

// Fixed pixel-like coordinate space, scaled uniformly to the container via
// CSS width:100%/height:auto (no preserveAspectRatio="none" — that stretches
// every mark AND every text label non-uniformly the moment the rendered
// aspect ratio differs from the viewBox's, which is exactly what happened
// here the first time around: garbled, unreadable axis labels).
const VIEW_W = 900;
const VIEW_H = 220;
const AXIS_LABEL_H = 24; // reserved for the x-axis date labels
const BAR_MAX_W = 24;
const SEGMENT_GAP = 2; // surface gap between stacked segments
const AXIS_COLOR = "#c3c2b7"; // baseline/axis, one step off the cream surface
const GRID_COLOR = "#d9d7cd"; // hairline gridline, recessive
const MUTED = "#89877f"; // axis/label ink

type Tooltip = { x: number; y: number; label: string; source: string; count: number };

export default function StackedBarChart({ buckets, legend }: { buckets: Bucket[]; legend: { label: string; color: string }[] }) {
  const [tooltip, setTooltip] = useState<Tooltip | null>(null);

  if (buckets.length === 0) {
    return <p style={{ opacity: 0.6 }}>no traffic in this range</p>;
  }

  const maxTotal = Math.max(1, ...buckets.map((b) => b.total));
  // Round the axis ceiling up to a clean step so gridline labels are round
  // numbers, not the raw max.
  const magnitude = Math.pow(10, Math.floor(Math.log10(maxTotal)));
  const niceMax = Math.ceil(maxTotal / magnitude) * magnitude || 1;
  const gridSteps = [0, niceMax * 0.25, niceMax * 0.5, niceMax * 0.75, niceMax];

  const plotH = VIEW_H - AXIS_LABEL_H;
  const slotW = VIEW_W / buckets.length;
  const barW = Math.min(BAR_MAX_W, slotW * 0.7);

  // Skip x labels if there are too many buckets to fit without collision.
  const labelStride = Math.ceil(buckets.length / 14);

  return (
    <div style={{ position: "relative" }}>
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        style={{ width: "100%", height: "auto", display: "block", overflow: "visible" }}
        role="img"
        aria-label="Pageviews over time, stacked by traffic source"
      >
        {gridSteps.map((v) => {
          const y = plotH - (v / niceMax) * plotH;
          return (
            <g key={v}>
              <line x1={0} x2={VIEW_W} y1={y} y2={y} stroke={GRID_COLOR} strokeWidth={1} />
              <text x={0} y={y - 4} fontSize={11} fill={MUTED} fontFamily="monospace">
                {Math.round(v)}
              </text>
            </g>
          );
        })}
        <line x1={0} x2={VIEW_W} y1={plotH} y2={plotH} stroke={AXIS_COLOR} strokeWidth={1} />

        {buckets.map((bucket, i) => {
          const barX = i * slotW + (slotW - barW) / 2;
          let cursorY = plotH;
          const segments = bucket.sources.map((s, si) => {
            const h = (s.count / niceMax) * plotH;
            const y = cursorY - h;
            cursorY = y - SEGMENT_GAP;
            const isTop = si === bucket.sources.length - 1;
            return { ...s, x: barX, y, w: barW, h: Math.max(h, 0), isTop };
          });
          return (
            <g key={bucket.label + i}>
              {segments.map((seg, si) => (
                <rect
                  key={si}
                  x={seg.x}
                  y={seg.y}
                  width={seg.w}
                  height={seg.h}
                  fill={seg.color}
                  rx={seg.isTop ? 3 : 0}
                  style={{ cursor: "pointer" }}
                  tabIndex={0}
                  onMouseEnter={() => setTooltip({ x: seg.x + seg.w / 2, y: seg.y, label: bucket.label, source: seg.label, count: seg.count })}
                  onFocus={() => setTooltip({ x: seg.x + seg.w / 2, y: seg.y, label: bucket.label, source: seg.label, count: seg.count })}
                  onMouseLeave={() => setTooltip(null)}
                  onBlur={() => setTooltip(null)}
                />
              ))}
              {bucket.total > 0 && (
                <text x={barX + barW / 2} y={cursorY - 4} fontSize={10} fill={MUTED} textAnchor="middle" fontFamily="monospace">
                  {bucket.total}
                </text>
              )}
              {i % labelStride === 0 && (
                <text x={barX + barW / 2} y={plotH + 16} fontSize={10} fill={MUTED} textAnchor="middle" fontFamily="monospace">
                  {bucket.label}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      {tooltip && (
        <div
          style={{
            position: "absolute",
            left: `${(tooltip.x / VIEW_W) * 100}%`,
            top: `${(tooltip.y / VIEW_H) * 100}%`,
            transform: "translate(-50%, -100%)",
            background: "#1f1934",
            color: "#eae8e0",
            fontSize: 12,
            padding: "6px 10px",
            borderRadius: 4,
            whiteSpace: "nowrap",
            pointerEvents: "none",
            marginTop: -6,
          }}
        >
          <strong>{tooltip.count}</strong> {tooltip.source} — {tooltip.label}
        </div>
      )}

      {legend.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 16, marginTop: 16, fontSize: 13 }}>
          {legend.map((entry) => (
            <div key={entry.label} style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ width: 10, height: 10, background: entry.color, borderRadius: 2, display: "inline-block" }} />
              {entry.label}
            </div>
          ))}
        </div>
      )}

      <details style={{ marginTop: 16, fontSize: 13 }}>
        <summary style={{ cursor: "pointer", opacity: 0.6 }}>table view</summary>
        <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 8 }}>
          <thead>
            <tr style={{ textAlign: "left", opacity: 0.6 }}>
              <th style={{ fontWeight: "normal", padding: "4px 0" }}>date</th>
              {legend.map((entry) => (
                <th key={entry.label} style={{ fontWeight: "normal", padding: "4px 0", textAlign: "right" }}>
                  {entry.label}
                </th>
              ))}
              <th style={{ fontWeight: "normal", padding: "4px 0", textAlign: "right" }}>total</th>
            </tr>
          </thead>
          <tbody>
            {buckets.map((bucket, i) => (
              <tr key={bucket.label + i} style={{ borderTop: "1px solid rgba(31,25,52,0.1)" }}>
                <td style={{ padding: "4px 0" }}>{bucket.label}</td>
                {legend.map((entry) => (
                  <td key={entry.label} style={{ padding: "4px 0", textAlign: "right" }}>
                    {bucket.sources.find((s) => s.label === entry.label)?.count ?? 0}
                  </td>
                ))}
                <td style={{ padding: "4px 0", textAlign: "right" }}>{bucket.total}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
