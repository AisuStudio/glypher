"use client";

import { useEffect, useRef } from "react";
import { getStroke } from "perfect-freehand";
import styles from "./page.module.css";
import { outlineToPath, type PathCommand } from "@/lib/contour";
import type { Stroke, StrokePoint } from "@/lib/strokes";

export type StrokeOptions = { size: number; thinning: number; smoothing: number; streamline: number };

const CELL_COLOR = "#1f1934";

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

type Props = {
  label: string;
  outlines: [number, number][][];
  strokeOptions: StrokeOptions;
  onStrokeComplete: (stroke: Stroke) => void;
};

export default function GridCell({ label, outlines, strokeOptions, onStrokeComplete }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const pointsRef = useRef<StrokePoint[]>([]);
  const drawingRef = useRef(false);
  const outlinesRef = useRef(outlines);
  const strokeOptionsRef = useRef(strokeOptions);
  const onStrokeCompleteRef = useRef(onStrokeComplete);

  outlinesRef.current = outlines;
  strokeOptionsRef.current = strokeOptions;
  onStrokeCompleteRef.current = onStrokeComplete;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    function redraw() {
      if (!canvas || !ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
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

    function onPointerDown(e: PointerEvent) {
      canvas!.setPointerCapture(e.pointerId);
      drawingRef.current = true;
      pointsRef.current = [pointFromEvent(e)];
    }

    function onPointerMove(e: PointerEvent) {
      if (!drawingRef.current) return;
      pointsRef.current.push(pointFromEvent(e));
      redraw();
    }

    function onPointerUp(e: PointerEvent) {
      if (drawingRef.current && pointsRef.current.length > 1) {
        onStrokeCompleteRef.current({
          id: `${Date.now()}-${Math.round(Math.random() * 1e6)}`,
          points: pointsRef.current,
          createdAt: Date.now(),
        });
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
    // Mount once per cell; outlines/onStrokeComplete are read via refs above
    // so redraws after a parent re-render don't need to tear down listeners.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const outline of outlines) fillOutline(ctx, outline);
  }, [outlines]);

  return (
    <div className={styles.gridCell}>
      <canvas ref={canvasRef} className={styles.gridCellCanvas} />
      <span className={styles.gridCellLabel}>{label}</span>
    </div>
  );
}
