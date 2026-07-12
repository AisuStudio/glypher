"use client";

import { useEffect, useRef } from "react";
import { getStroke } from "perfect-freehand";
import styles from "./page.module.css";
import { outlineToPath, type PathCommand } from "@/lib/contour";
import type { Stroke, StrokePoint } from "@/lib/strokes";
import type { Metrics } from "@/lib/metrics";
import { unicodeFor } from "@/lib/glyphs";

export type StrokeOptions = { size: number; thinning: number; smoothing: number; streamline: number };

const CELL_COLOR = "#1f1934";
const GUIDE_COLOR = "#9e9c95"; // hazelnut
const BEARING_COLOR = "#5100ff"; // grape — matches the draggable-affordance color used elsewhere
const BEARING_HIT_PX = 8;

export const DEFAULT_LEFT_BEARING = 0.15;
export const DEFAULT_RIGHT_BEARING = 0.85;

function applyPath(ctx: CanvasRenderingContext2D, commands: PathCommand[]) {
  for (const c of commands) {
    if (c.type === "M") ctx.moveTo(c.x, c.y);
    else if (c.type === "Q") ctx.quadraticCurveTo(c.cx, c.cy, c.x, c.y);
    else ctx.closePath();
  }
}

function fillOutline(ctx: CanvasRenderingContext2D, outline: [number, number][]) {
  if (outline.length < 3) return;
  ctx.beginPath();
  applyPath(ctx, outlineToPath(outline));
  ctx.fillStyle = CELL_COLOR;
  ctx.fill();
}

function drawGuides(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  metrics: Metrics,
  leftBearing: number,
  rightBearing: number
) {
  ctx.save();
  ctx.lineWidth = 0.5;

  ctx.strokeStyle = GUIDE_COLOR;
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  const ascY = Math.round(metrics.ascender * height) + 0.5;
  const descY = Math.round(metrics.descender * height) + 0.5;
  ctx.moveTo(0, ascY);
  ctx.lineTo(width, ascY);
  ctx.moveTo(0, descY);
  ctx.lineTo(width, descY);
  ctx.stroke();

  ctx.setLineDash([]);
  ctx.beginPath();
  const baseY = Math.round(metrics.baseline * height) + 0.5;
  ctx.moveTo(0, baseY);
  ctx.lineTo(width, baseY);
  ctx.stroke();

  ctx.strokeStyle = BEARING_COLOR;
  ctx.globalAlpha = 0.6;
  ctx.setLineDash([1, 3]);
  ctx.beginPath();
  const lx = Math.round(leftBearing * width) + 0.5;
  const rx = Math.round(rightBearing * width) + 0.5;
  ctx.moveTo(lx, 0);
  ctx.lineTo(lx, height);
  ctx.moveTo(rx, 0);
  ctx.lineTo(rx, height);
  ctx.stroke();

  // Grip handles at the vertical center — the visual cue that these lines
  // are draggable, not just static guides.
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;
  const handleY = height / 2;
  for (const hx of [lx, rx]) {
    ctx.beginPath();
    ctx.arc(hx, handleY, 4, 0, Math.PI * 2);
    ctx.fillStyle = BEARING_COLOR;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(hx, handleY, 4, 0, Math.PI * 2);
    ctx.strokeStyle = "#eae8e0"; // vanilla — ring for contrast against the stroke color
    ctx.lineWidth = 0.5;
    ctx.stroke();
  }

  ctx.restore();
}

type Props = {
  label: string;
  outlines: [number, number][][];
  strokeOptions: StrokeOptions;
  onStrokeComplete: (stroke: Stroke, cellWidth: number, cellHeight: number) => void;
  metrics: Metrics;
  leftBearing?: number;
  rightBearing?: number;
  onBearingsChange: (left: number, right: number) => void;
};

export default function GridCell({
  label,
  outlines,
  strokeOptions,
  onStrokeComplete,
  metrics,
  leftBearing = DEFAULT_LEFT_BEARING,
  rightBearing = DEFAULT_RIGHT_BEARING,
  onBearingsChange,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const pointsRef = useRef<StrokePoint[]>([]);
  const drawingRef = useRef(false);
  const outlinesRef = useRef(outlines);
  const strokeOptionsRef = useRef(strokeOptions);
  const onStrokeCompleteRef = useRef(onStrokeComplete);
  const metricsRef = useRef(metrics);
  const bearingsRef = useRef({ leftBearing, rightBearing });
  const onBearingsChangeRef = useRef(onBearingsChange);
  const draggingRef = useRef<"left" | "right" | null>(null);

  outlinesRef.current = outlines;
  strokeOptionsRef.current = strokeOptions;
  onStrokeCompleteRef.current = onStrokeComplete;
  metricsRef.current = metrics;
  bearingsRef.current = { leftBearing, rightBearing };
  onBearingsChangeRef.current = onBearingsChange;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    function redraw() {
      if (!canvas || !ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      drawGuides(
        ctx,
        canvas.clientWidth,
        canvas.clientHeight,
        metricsRef.current,
        bearingsRef.current.leftBearing,
        bearingsRef.current.rightBearing
      );
      for (const outline of outlinesRef.current) fillOutline(ctx, outline);
      if (pointsRef.current.length > 0) {
        fillOutline(ctx, getStroke(pointsRef.current, strokeOptionsRef.current) as [number, number][]);
      }
    }

    function resize() {
      if (!canvas) return;
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      canvas.getContext("2d")?.scale(dpr, dpr);
      redraw();
    }
    resize();
    window.addEventListener("resize", resize);

    function pointFromEvent(e: PointerEvent): StrokePoint {
      const rect = canvas!.getBoundingClientRect();
      return [e.clientX - rect.left, e.clientY - rect.top, e.pressure > 0 ? e.pressure : 0.5];
    }

    function bearingNear(x: number, width: number): "left" | "right" | null {
      const lx = bearingsRef.current.leftBearing * width;
      const rx = bearingsRef.current.rightBearing * width;
      if (Math.abs(x - lx) <= BEARING_HIT_PX) return "left";
      if (Math.abs(x - rx) <= BEARING_HIT_PX) return "right";
      return null;
    }

    function onPointerDown(e: PointerEvent) {
      canvas!.setPointerCapture(e.pointerId);
      const [x] = pointFromEvent(e);
      const hit = bearingNear(x, canvas!.clientWidth);
      if (hit) {
        draggingRef.current = hit;
        return;
      }
      drawingRef.current = true;
      pointsRef.current = [pointFromEvent(e)];
    }

    function onPointerMove(e: PointerEvent) {
      if (draggingRef.current) {
        const [x] = pointFromEvent(e);
        const fraction = Math.min(1, Math.max(0, x / canvas!.clientWidth));
        const { leftBearing: l, rightBearing: r } = bearingsRef.current;
        const next =
          draggingRef.current === "left"
            ? { leftBearing: Math.min(fraction, r - 0.02), rightBearing: r }
            : { leftBearing: l, rightBearing: Math.max(fraction, l + 0.02) };
        bearingsRef.current = next;
        redraw();
        return;
      }
      if (drawingRef.current) {
        pointsRef.current.push(pointFromEvent(e));
        redraw();
        return;
      }
      // Idle hover: show a resize cursor near a bearing line so it reads as
      // draggable before the user commits to a pointerdown.
      const [x] = pointFromEvent(e);
      canvas!.style.cursor = bearingNear(x, canvas!.clientWidth) ? "ew-resize" : "";
    }

    function onPointerUp(e: PointerEvent) {
      if (draggingRef.current) {
        onBearingsChangeRef.current(bearingsRef.current.leftBearing, bearingsRef.current.rightBearing);
        draggingRef.current = null;
        canvas!.releasePointerCapture(e.pointerId);
        return;
      }
      if (drawingRef.current && pointsRef.current.length > 1) {
        onStrokeCompleteRef.current(
          {
            id: `${Date.now()}-${Math.round(Math.random() * 1e6)}`,
            points: pointsRef.current,
            createdAt: Date.now(),
          },
          canvas!.clientWidth,
          canvas!.clientHeight
        );
      }
      drawingRef.current = false;
      pointsRef.current = [];
      canvas!.releasePointerCapture(e.pointerId);
      redraw();
    }

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerUp);

    return () => {
      window.removeEventListener("resize", resize);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerUp);
    };
    // Mount once per cell; outlines/onStrokeComplete/metrics/bearings are read
    // via refs above so redraws after a parent re-render don't need to tear
    // down listeners.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawGuides(ctx, canvas.clientWidth, canvas.clientHeight, metrics, leftBearing, rightBearing);
    for (const outline of outlines) fillOutline(ctx, outline);
  }, [outlines, metrics, leftBearing, rightBearing]);

  const unicode = unicodeFor(label);

  return (
    <div className={styles.gridCell}>
      <canvas ref={canvasRef} className={styles.gridCellCanvas} />
      <div className={styles.gridCellLabelBar}>
        <span className={styles.gridCellLabelChar}>{label}</span>
        {unicode && <span className={styles.gridCellLabelUnicode}>{unicode}</span>}
      </div>
    </div>
  );
}
