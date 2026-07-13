"use client";

import { useEffect, useMemo, useRef } from "react";
import { getStroke } from "perfect-freehand";
import styles from "./page.module.css";
import { layoutText } from "@/lib/layoutText";
import { outlineToPath, type PathCommand } from "@/lib/contour";
import type { Glyph } from "@/lib/glyphs";
import type { Stroke, StrokePoint } from "@/lib/strokes";
import type { Metrics } from "@/lib/metrics";
import type { StrokeSettings } from "@/lib/settings";

type Props = {
  glyphs: Glyph[];
  strokes: Stroke[];
  metrics: Metrics;
  settings: StrokeSettings;
  text: string;
  onTextChange: (text: string) => void;
};

const INK_COLOR = "#1f1934"; // blueberry, same as untagged/default ink everywhere else
const LINE_GAP = 24; // breathing room between stacked lines, beyond each line's own ascender/descender

// Small local duplicates of page.tsx's canvas helpers (applyPath/fillOutline/
// outlineFor) — same duplication convention already used between page.tsx
// and GridCell.tsx, since each owns its own <canvas> and there's no shared
// canvas-rendering module in this codebase.
function optionsFor(settings: StrokeSettings) {
  return {
    size: settings.size,
    thinning: settings.mode === "mono" ? 0 : settings.thinning,
    smoothing: settings.smoothing,
    streamline: settings.streamline,
  };
}

function outlineFor(points: StrokePoint[], settings: StrokeSettings): [number, number][] {
  return getStroke(points, optionsFor(settings)) as [number, number][];
}

function applyPath(ctx: CanvasRenderingContext2D, commands: PathCommand[]) {
  for (const c of commands) {
    if (c.type === "M") ctx.moveTo(c.x, c.y);
    else if (c.type === "Q") ctx.quadraticCurveTo(c.cx, c.cy, c.x, c.y);
    else if (c.type === "L") ctx.lineTo(c.x, c.y);
    else ctx.closePath();
  }
}

function fillOutline(ctx: CanvasRenderingContext2D, outline: [number, number][]) {
  if (outline.length < 3) return;
  ctx.beginPath();
  applyPath(ctx, outlineToPath(outline));
  ctx.fillStyle = INK_COLOR;
  ctx.fill();
}

export default function EditorPanel({ glyphs, strokes, metrics, settings, text, onTextChange }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Phase 1 (per the plan): read-only composition/preview — type using
  // already-tagged glyphs, no direct drawing/erasing/reshaping here yet.
  // Missing-glyph detection is its own memo (not read out of the draw
  // effect below) purely for the warning line under the textarea.
  const missing = useMemo(() => {
    const all = new Set<string>();
    for (const line of text.split("\n")) {
      for (const c of layoutText(line, glyphs, strokes, metrics).missing) all.add(c);
    }
    return [...all];
  }, [text, glyphs, strokes, metrics]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    function draw() {
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas!.getBoundingClientRect();
      canvas!.width = rect.width * dpr;
      canvas!.height = rect.height * dpr;
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx!.clearRect(0, 0, rect.width, rect.height);

      let lineY = 0;
      for (const line of text.split("\n")) {
        const layout = layoutText(line, glyphs, strokes, metrics);
        for (const entry of layout.entries) {
          if (entry.kind !== "glyph") continue;
          for (const strokePoints of entry.strokePointSets) {
            // Each glyph's raw pen points, transformed by layoutText's own
            // per-glyph offset/scale (the same Grid-bearing-aware or
            // bbox-fallback calibration Animate mode already uses) plus
            // this line's running Y offset — pressure carried straight
            // through untouched, so the composed text still renders with
            // real perfect-freehand thickness variation, not a flattened
            // skeleton.
            const transformed: StrokePoint[] = strokePoints.map((p) => [
              p[0] * entry.scale + entry.offsetX,
              p[1] * entry.scale + entry.offsetY + lineY,
              p[2],
            ]);
            fillOutline(ctx!, outlineFor(transformed, settings));
          }
        }
        lineY += layout.height + LINE_GAP;
      }
    }

    draw();
    const resizeObserver = new ResizeObserver(draw);
    resizeObserver.observe(canvas);
    return () => resizeObserver.disconnect();
  }, [text, glyphs, strokes, metrics, settings]);

  return (
    <div className={styles.editorPanel}>
      <textarea
        className={styles.editorInput}
        value={text}
        onChange={(e) => onTextChange(e.target.value)}
        placeholder="Type using your tagged glyphs…"
        spellCheck={false}
      />
      {missing.length > 0 && (
        <div className={styles.animateWarning}>missing glyphs: {missing.join(" ")}</div>
      )}
      <canvas ref={canvasRef} className={styles.editorCanvas} />
    </div>
  );
}
