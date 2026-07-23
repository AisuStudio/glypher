"use client";

import { useEffect, useRef } from "react";
import { getStroke } from "perfect-freehand";
import styles from "./page.module.css";
import { outlineToPath, skeletonToPath, type PathCommand } from "@/lib/contour";
import { pointInPolygon, anyPointInPolygon, fitPointsToBox } from "@/lib/geometry";
import { simplifyStrokeIndices } from "@/lib/simplify";
import type { StrokeKind, StrokePoint } from "@/lib/strokes";
import type { Metrics } from "@/lib/metrics";
import { unicodeFor } from "@/lib/glyphs";
import { setClipboard, getClipboard, type ClipboardStroke } from "@/lib/clipboard";

export type StrokeOptions = { size: number; thinning: number; smoothing: number; streamline: number };
export type CellTool = "pen" | "brush" | "eraser" | "select" | "nudge" | "move" | "rotate" | "scale";
// Raw points now, not a precomputed outline — Nudge/Move/Rotate/Scale need
// the real geometry to reshape/transform; the cell computes its own outline
// from these via outlineFor() below, the same split Free's own canvas uses.
// widthScale mirrors page.tsx's Stroke field — a Scale gesture bakes its
// magnitude in here so thickness scales with the shape instead of staying
// fixed; undefined (pre-existing strokes) === 1.
export type CellStroke = { id: string; points: StrokePoint[]; widthScale?: number; kind?: StrokeKind };

const CELL_COLOR = "#1f1934";
const SELECTED_COLOR = "#d8ff01"; // lemon — matches Free canvas's selection color
const GUIDE_COLOR = "#9e9c95"; // hazelnut
const BEARING_COLOR = "#5100ff"; // grape — matches the draggable-affordance color used elsewhere
const BEARING_HIT_PX = 8;
const ANCHOR_HIT_PX = 8;
const ANCHOR_COLOR = "#5100ff";
const ANCHOR_RING_COLOR = "#eae8e0"; // vanilla

// Tools whose pointerdown-through-pointerup gesture is "drag a lasso and
// replace the local selection with whatever it enclosed" — mirrors
// page.tsx's LASSO_TOOLS. Grid has no Assign (auto-tags on draw), so Select
// is the only member here.
const LASSO_TOOLS = new Set<CellTool>(["select"]);
// Tools that read (rather than replace) the current selection.
const SELECTION_TOOLS = new Set<CellTool>(["select", "move", "rotate", "scale"]);
const TRANSFORM_TOOLS = new Set<CellTool>(["move", "rotate", "scale"]);

export const DEFAULT_LEFT_BEARING = 0.15;
export const DEFAULT_RIGHT_BEARING = 0.85;

function applyPath(ctx: CanvasRenderingContext2D, commands: PathCommand[]) {
  for (const c of commands) {
    if (c.type === "M") ctx.moveTo(c.x, c.y);
    else if (c.type === "Q") ctx.quadraticCurveTo(c.cx, c.cy, c.x, c.y);
    else if (c.type === "L") ctx.lineTo(c.x, c.y);
    else ctx.closePath();
  }
}

function fillOutline(ctx: CanvasRenderingContext2D, outline: [number, number][], color: string = CELL_COLOR) {
  if (outline.length < 3) return;
  ctx.beginPath();
  applyPath(ctx, outlineToPath(outline));
  ctx.fillStyle = color;
  ctx.fill();
}

function outlineFor(points: StrokePoint[], options: StrokeOptions): [number, number][] {
  return getStroke(points, options) as [number, number][];
}

// Mirrors page.tsx's effectiveSettingsFor — bakes a stroke's own widthScale
// into the size passed to outlineFor, so rendering/hit-testing reflect its
// actual (possibly scaled) thickness instead of the shared global size.
function effectiveOptionsFor(stroke: CellStroke, options: StrokeOptions): StrokeOptions {
  const ws = stroke.widthScale ?? 1;
  return ws === 1 ? options : { ...options, size: options.size * ws };
}

// Pivot for Move/Rotate/Scale: bbox center across every currently-selected
// stroke's points in THIS cell — mirrors page.tsx's own selectionPivot.
function selectionPivot(strokes: CellStroke[], ids: Set<string>): { x: number; y: number } {
  const points = strokes.filter((s) => ids.has(s.id)).flatMap((s) => s.points);
  let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity;
  for (const [x, y] of points) {
    xmin = Math.min(xmin, x); xmax = Math.max(xmax, x);
    ymin = Math.min(ymin, y); ymax = Math.max(ymax, y);
  }
  return { x: (xmin + xmax) / 2, y: (ymin + ymax) / 2 };
}

// Default Scale anchor (no modifier): bbox bottom-left — mirrors page.tsx's
// selectionBottomLeft.
function selectionBottomLeft(strokes: CellStroke[], ids: Set<string>): { x: number; y: number } {
  const points = strokes.filter((s) => ids.has(s.id)).flatMap((s) => s.points);
  let xmin = Infinity, ymax = -Infinity;
  for (const [x, y] of points) {
    xmin = Math.min(xmin, x);
    ymax = Math.max(ymax, y);
  }
  return { x: xmin, y: ymax };
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
  const xHeightY = Math.round(metrics.xHeight * height) + 0.5;
  const descY = Math.round(metrics.descender * height) + 0.5;
  ctx.moveTo(0, ascY);
  ctx.lineTo(width, ascY);
  ctx.moveTo(0, xHeightY);
  ctx.lineTo(width, xHeightY);
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
  strokes: CellStroke[];
  tool: CellTool;
  // Takes a Set (not a single id) so a batch delete — the Delete-key
  // handler removing a whole selection — reaches the parent as ONE call,
  // and therefore one undo step, instead of one per stroke.
  onErase: (ids: Set<string>) => void;
  onStrokesChange: (updates: { id: string; points: StrokePoint[]; widthScale?: number }[]) => void;
  strokeOptions: StrokeOptions;
  onStrokeComplete: (
    stroke: { id: string; points: StrokePoint[]; createdAt: number; kind?: StrokeKind },
    cellWidth: number,
    cellHeight: number,
    // Wall-clock span of the pointerdown→pointerup gesture — only this
    // component knows it, so it rides along on the existing callback
    // instead of the parent needing its own per-cell timing. Consumed by
    // the provenance event the parent enqueues (see page.tsx's
    // handleGridStroke).
    durationMs: number
  ) => void;
  metrics: Metrics;
  leftBearing?: number;
  rightBearing?: number;
  onBearingsChange: (left: number, right: number) => void;
  // Reports the canvas's own actual CSS pixel size (not the grid row's
  // nominal height) — the label bar underneath the letter takes some of
  // that row's height for itself, so the canvas is always a bit shorter
  // than cellSize*CELL_ASPECT_RATIO. The parent needs this real size, not
  // the nominal one, to keep a glyph's stored points and its guide-line
  // metrics rescaling in lockstep with whatever's actually on screen.
  onResize?: (width: number, height: number) => void;
  // This cell's authoritative width in CSS px — either the global Width
  // slider's value or a glyph's own override (page.tsx resolves which).
  // Applied directly to the wrapper's style, not derived from a CSS grid
  // track, so a single cell can be wider or narrower than its neighbors.
  widthPx: number;
  // Height stays global-only (no per-glyph override, unlike width) — .grid
  // is a flex-wrap now, not a CSS grid, so nothing sizes rows for us
  // automatically the way grid-auto-rows used to.
  heightPx: number;
  // Present only once a glyph exists here (see page.tsx) — dragging the
  // right-edge handle calls this once, on release, with the final width;
  // the live drag itself mutates the DOM directly (see handleWidthPointerMove)
  // rather than round-tripping through React on every pointermove.
  onWidthCommit?: (newWidthPx: number) => void;
  // Double-clicking the handle clears the glyph's own override so it goes
  // back to following the global Width slider.
  onWidthReset?: () => void;
};

export default function GridCell({
  label,
  strokes,
  tool,
  onErase,
  onStrokesChange,
  strokeOptions,
  onStrokeComplete,
  metrics,
  leftBearing = DEFAULT_LEFT_BEARING,
  rightBearing = DEFAULT_RIGHT_BEARING,
  onBearingsChange,
  onResize,
  widthPx,
  heightPx,
  onWidthCommit,
  onWidthReset,
}: Props) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const pointsRef = useRef<StrokePoint[]>([]);
  const drawingRef = useRef(false);
  const strokeStartTimeRef = useRef(0);
  const strokesRef = useRef(strokes);
  const toolRef = useRef(tool);
  const onEraseRef = useRef(onErase);
  const onStrokesChangeRef = useRef(onStrokesChange);
  const strokeOptionsRef = useRef(strokeOptions);
  const onStrokeCompleteRef = useRef(onStrokeComplete);
  const metricsRef = useRef(metrics);
  const bearingsRef = useRef({ leftBearing, rightBearing });
  const onBearingsChangeRef = useRef(onBearingsChange);
  const onResizeRef = useRef(onResize);
  const draggingRef = useRef<"left" | "right" | null>(null);
  const redrawRef = useRef<() => void>(() => {});

  const lassoRef = useRef<[number, number][]>([]);
  const selectedIdsRef = useRef<Set<string>>(new Set());
  // Current authoritative cell size for Copy/Paste's target-box scaling
  // (see onKeyDown below) — read from a ref, not the widthPx/heightPx props
  // directly, since the keydown listener effect mounts once and would
  // otherwise close over stale values from whatever render it first attached in.
  const cellDimsRef = useRef({ width: widthPx, height: heightPx });

  // Nudge: which stroke is being reshaped, its Douglas-Peucker-simplified
  // anchor indices, whether it's been resampled down to just those anchors
  // yet (lazy, first drag only), and which anchor is mid-drag — exact same
  // shape as the Free canvas's own Nudge state in page.tsx.
  const editingStrokeIdRef = useRef<string | null>(null);
  const anchorIndicesRef = useRef<number[]>([]);
  const resampledRef = useRef(false);
  const draggingAnchorRef = useRef<number | null>(null);

  // Move/Rotate/Scale: pivot + frozen pre-drag snapshot, captured once on
  // the pointerdown that hits a selected stroke — every pointermove
  // recomputes from this snapshot rather than the live (already-mutated)
  // points. Mirrors page.tsx's transformStartRef exactly.
  const transformStartRef = useRef<{
    mode: "move" | "rotate" | "scale";
    pivotX: number;
    pivotY: number;
    startX: number;
    startY: number;
    startDist: number;
    startAngle: number;
    startDx: number;
    startDy: number;
    uniform: boolean;
    lastScaleX: number;
    lastScaleY: number;
    snapshot: Map<string, StrokePoint[]>;
  } | null>(null);

  toolRef.current = tool;
  onEraseRef.current = onErase;
  onStrokesChangeRef.current = onStrokesChange;
  strokeOptionsRef.current = strokeOptions;
  onStrokeCompleteRef.current = onStrokeComplete;
  metricsRef.current = metrics;
  // Skip while a drag is in progress: a stray parent re-render mid-drag
  // (e.g. Safari's dynamic toolbar resizing the viewport during a pencil
  // gesture) would otherwise clobber the in-flight ref value back to the
  // still-uncommitted prop, snapping the bearing back to its pre-drag spot
  // — onPointerUp is what actually commits the dragged value upward.
  if (!draggingRef.current) {
    bearingsRef.current = { leftBearing, rightBearing };
  }
  onBearingsChangeRef.current = onBearingsChange;
  onResizeRef.current = onResize;
  cellDimsRef.current = { width: widthPx, height: heightPx };
  // Same clobber-guard, generalized: don't resync the working stroke data
  // from props while a Nudge or Move/Rotate/Scale edit is live, or the
  // in-flight reshape/transform would revert to the last-committed shape
  // the moment any unrelated parent re-render happens.
  const editingStroke = editingStrokeIdRef.current !== null || transformStartRef.current !== null;
  if (!editingStroke) {
    strokesRef.current = strokes;
  }

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
      for (const s of strokesRef.current) {
        const color =
          s.id === editingStrokeIdRef.current || selectedIdsRef.current.has(s.id) ? SELECTED_COLOR : CELL_COLOR;
        fillOutline(ctx, outlineFor(s.points, effectiveOptionsFor(s, strokeOptionsRef.current)), color);
      }
      if (pointsRef.current.length > 0) {
        fillOutline(ctx, outlineFor(pointsRef.current, strokeOptionsRef.current));
      }
      if (lassoRef.current.length > 1) {
        ctx.save();
        ctx.strokeStyle = BEARING_COLOR;
        ctx.setLineDash([4, 4]);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(lassoRef.current[0][0], lassoRef.current[0][1]);
        for (let i = 1; i < lassoRef.current.length; i++) ctx.lineTo(lassoRef.current[i][0], lassoRef.current[i][1]);
        ctx.stroke();
        ctx.restore();
      }
      if (toolRef.current === "nudge" && editingStrokeIdRef.current) {
        const stroke = strokesRef.current.find((s) => s.id === editingStrokeIdRef.current);
        if (stroke) {
          // The literal "core path" — same live skeleton-centerline render
          // Free's own Nudge tool uses, not the filled perfect-freehand
          // outline.
          ctx.save();
          ctx.beginPath();
          applyPath(ctx, skeletonToPath(stroke.points.map((p) => [p[0], p[1]] as [number, number])));
          ctx.strokeStyle = ANCHOR_COLOR;
          ctx.lineWidth = 1;
          ctx.stroke();
          ctx.restore();

          for (const idx of anchorIndicesRef.current) {
            const [ax, ay] = stroke.points[idx];
            ctx.beginPath();
            ctx.arc(ax, ay, 4, 0, Math.PI * 2);
            ctx.fillStyle = ANCHOR_COLOR;
            ctx.fill();
            ctx.beginPath();
            ctx.arc(ax, ay, 4, 0, Math.PI * 2);
            ctx.strokeStyle = ANCHOR_RING_COLOR;
            ctx.lineWidth = 0.5;
            ctx.stroke();
          }
        }
      }
      if (TRANSFORM_TOOLS.has(toolRef.current) && transformStartRef.current) {
        const t = transformStartRef.current;
        ctx.beginPath();
        ctx.arc(t.pivotX, t.pivotY, 4, 0, Math.PI * 2);
        ctx.fillStyle = ANCHOR_COLOR;
        ctx.fill();
        ctx.beginPath();
        ctx.arc(t.pivotX, t.pivotY, 4, 0, Math.PI * 2);
        ctx.strokeStyle = ANCHOR_RING_COLOR;
        ctx.lineWidth = 0.5;
        ctx.stroke();
      }
    }
    redrawRef.current = redraw;

    function resize() {
      if (!canvas) return;
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      canvas.getContext("2d")?.scale(dpr, dpr);
      onResizeRef.current?.(rect.width, rect.height);
      redraw();
    }
    resize();
    // The cell's box can change size from a CSS layout shift (e.g. the "Cell
    // size" slider changing grid-template-columns) with no window resize
    // event at all — a plain window "resize" listener misses that entirely,
    // leaving canvas.width/height (and therefore every guide/bearing
    // position) stuck at whatever they were on mount. ResizeObserver catches
    // any layout-driven size change to the canvas itself.
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvas);

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

    function anchorNear(x: number, y: number, points: StrokePoint[], indices: number[]): number | null {
      for (let rank = indices.length - 1; rank >= 0; rank--) {
        const [px, py] = points[indices[rank]];
        if (Math.hypot(x - px, y - py) <= ANCHOR_HIT_PX) return rank;
      }
      return null;
    }

    // Same click-to-edit / anchor-grab / lazy-resample logic as Free's own
    // handleNudgePointerDown, operating on this cell's local strokesRef
    // instead of page.tsx's completedRef.
    function handleNudgePointerDown(x: number, y: number) {
      if (editingStrokeIdRef.current) {
        const idx = strokesRef.current.findIndex((s) => s.id === editingStrokeIdRef.current);
        if (idx !== -1) {
          const stroke = strokesRef.current[idx];
          const rank = anchorNear(x, y, stroke.points, anchorIndicesRef.current);
          if (rank !== null) {
            if (!resampledRef.current) {
              stroke.points = anchorIndicesRef.current.map((i) => stroke.points[i]);
              anchorIndicesRef.current = stroke.points.map((_, i) => i);
              resampledRef.current = true;
            }
            draggingAnchorRef.current = rank;
            return;
          }
        }
      }
      for (let i = strokesRef.current.length - 1; i >= 0; i--) {
        const s = strokesRef.current[i];
        // A brush stroke's points trace its own edge, not a true centerline
        // — skip it, same as page.tsx's own Nudge/Anchor gating.
        if ((s.kind ?? "pen") === "brush") continue;
        if (pointInPolygon([x, y], outlineFor(s.points, effectiveOptionsFor(s, strokeOptionsRef.current)))) {
          editingStrokeIdRef.current = s.id;
          anchorIndicesRef.current = simplifyStrokeIndices(s.points.map((p) => [p[0], p[1]]));
          resampledRef.current = false;
          return;
        }
      }
      editingStrokeIdRef.current = null;
      anchorIndicesRef.current = [];
      resampledRef.current = false;
    }

    // Move/Rotate/Scale click: must land on an already-selected stroke
    // (Select populates selectedIdsRef first) — same split as page.tsx. For
    // Scale, the anchor is the selection's bbox bottom-left by default, or
    // its center if Alt is held; Shift locks the gesture to uniform scaling
    // — mirrors page.tsx's handleTransformPointerDown exactly.
    function handleTransformPointerDown(
      x: number,
      y: number,
      mode: "move" | "rotate" | "scale",
      altKey: boolean,
      shiftKey: boolean
    ) {
      let hit = false;
      for (let i = strokesRef.current.length - 1; i >= 0; i--) {
        const s = strokesRef.current[i];
        if (
          selectedIdsRef.current.has(s.id) &&
          pointInPolygon([x, y], outlineFor(s.points, effectiveOptionsFor(s, strokeOptionsRef.current)))
        ) {
          hit = true;
          break;
        }
      }
      if (!hit) return;
      const anchor =
        mode === "scale" && !altKey
          ? selectionBottomLeft(strokesRef.current, selectedIdsRef.current)
          : selectionPivot(strokesRef.current, selectedIdsRef.current);
      const snapshot = new Map(
        strokesRef.current
          .filter((s) => selectedIdsRef.current.has(s.id))
          .map((s) => [s.id, s.points.map((p) => [...p] as StrokePoint)] as const)
      );
      transformStartRef.current = {
        mode,
        pivotX: anchor.x,
        pivotY: anchor.y,
        startX: x,
        startY: y,
        startDist: Math.max(Math.hypot(x - anchor.x, y - anchor.y), 1),
        startAngle: Math.atan2(y - anchor.y, x - anchor.x),
        startDx: x - anchor.x,
        startDy: y - anchor.y,
        uniform: shiftKey,
        lastScaleX: 1,
        lastScaleY: 1,
        snapshot,
      };
    }

    function applyTransform(x: number, y: number) {
      const t = transformStartRef.current;
      if (!t) return;
      const dx = x - t.startX;
      const dy = y - t.startY;
      const angle = Math.atan2(y - t.pivotY, x - t.pivotX) - t.startAngle;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);

      const SCALE_EPS = 1;
      const dxNow = x - t.pivotX;
      const dyNow = y - t.pivotY;
      const uniformFactor = Math.max(Math.hypot(dxNow, dyNow), 1) / t.startDist;
      const rawScaleX = Math.abs(t.startDx) < SCALE_EPS ? 1 : dxNow / t.startDx;
      const rawScaleY = Math.abs(t.startDy) < SCALE_EPS ? 1 : dyNow / t.startDy;
      const scaleX = t.uniform ? uniformFactor : rawScaleX;
      const scaleY = t.uniform ? uniformFactor : rawScaleY;
      t.lastScaleX = scaleX;
      t.lastScaleY = scaleY;

      for (const [id, points] of t.snapshot) {
        const idx = strokesRef.current.findIndex((s) => s.id === id);
        if (idx === -1) continue;
        const stroke = strokesRef.current[idx];
        stroke.points = points.map(([px, py, pressure]) => {
          if (t.mode === "move") return [px + dx, py + dy, pressure] as StrokePoint;
          if (t.mode === "rotate") {
            const ox = px - t.pivotX;
            const oy = py - t.pivotY;
            return [t.pivotX + ox * cos - oy * sin, t.pivotY + ox * sin + oy * cos, pressure] as StrokePoint;
          }
          return [t.pivotX + (px - t.pivotX) * scaleX, t.pivotY + (py - t.pivotY) * scaleY, pressure] as StrokePoint;
        });
      }
    }

    function onPointerDown(e: PointerEvent) {
      // Every cell's keydown listener is on `window` (there's no per-cell
      // DOM subtree to scope it to otherwise) — Copy/Paste below relies on
      // DOM focus to know WHICH cell a Cmd+V should land in, so a real
      // interaction claims it. Without this, Cmd+V would fire in every
      // visible cell at once.
      canvas!.focus();
      canvas!.setPointerCapture(e.pointerId);
      const [x, y] = pointFromEvent(e);
      const hit = bearingNear(x, canvas!.clientWidth);
      if (hit) {
        draggingRef.current = hit;
        return;
      }
      if (toolRef.current === "eraser") {
        // Topmost (last-drawn) stroke wins when strokes overlap.
        for (let i = strokesRef.current.length - 1; i >= 0; i--) {
          const s = strokesRef.current[i];
          if (pointInPolygon([x, y], outlineFor(s.points, effectiveOptionsFor(s, strokeOptionsRef.current)))) {
            onEraseRef.current(new Set([s.id]));
            break;
          }
        }
        return;
      }
      if (toolRef.current === "nudge") {
        handleNudgePointerDown(x, y);
        redraw();
        return;
      }
      if (TRANSFORM_TOOLS.has(toolRef.current)) {
        handleTransformPointerDown(x, y, toolRef.current as "move" | "rotate" | "scale", e.altKey, e.shiftKey);
        redraw();
        return;
      }
      drawingRef.current = true;
      strokeStartTimeRef.current = Date.now();
      if (LASSO_TOOLS.has(toolRef.current)) {
        lassoRef.current = [[x, y]];
      } else {
        pointsRef.current = [pointFromEvent(e)];
      }
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
      const [x, y] = pointFromEvent(e);
      if (toolRef.current === "nudge") {
        if (draggingAnchorRef.current !== null && editingStrokeIdRef.current) {
          const idx = strokesRef.current.findIndex((s) => s.id === editingStrokeIdRef.current);
          if (idx !== -1) {
            const stroke = strokesRef.current[idx];
            const pointIdx = anchorIndicesRef.current[draggingAnchorRef.current];
            const prevPressure = stroke.points[pointIdx][2];
            stroke.points[pointIdx] = [x, y, prevPressure];
            redraw();
          }
          return;
        }
        canvas!.style.cursor = editingStrokeIdRef.current ? "grab" : "pointer";
        return;
      }
      if (transformStartRef.current) {
        applyTransform(x, y);
        redraw();
        return;
      }
      if (!drawingRef.current) {
        if (bearingNear(x, canvas!.clientWidth)) {
          canvas!.style.cursor = "ew-resize";
        } else if (toolRef.current === "eraser") {
          canvas!.style.cursor = "crosshair";
        } else if (TRANSFORM_TOOLS.has(toolRef.current)) {
          canvas!.style.cursor = "move";
        } else {
          canvas!.style.cursor = "";
        }
        return;
      }
      if (LASSO_TOOLS.has(toolRef.current)) {
        lassoRef.current.push([x, y]);
      } else {
        pointsRef.current.push([x, y, e.pressure > 0 ? e.pressure : 0.5]);
      }
      redraw();
    }

    function onPointerUp(e: PointerEvent) {
      if (draggingRef.current) {
        onBearingsChangeRef.current(bearingsRef.current.leftBearing, bearingsRef.current.rightBearing);
        draggingRef.current = null;
        canvas!.releasePointerCapture(e.pointerId);
        return;
      }
      if (toolRef.current === "nudge") {
        if (draggingAnchorRef.current !== null) {
          draggingAnchorRef.current = null;
          const stroke = strokesRef.current.find((s) => s.id === editingStrokeIdRef.current);
          if (stroke) onStrokesChangeRef.current([{ id: stroke.id, points: stroke.points }]);
        }
        canvas!.releasePointerCapture(e.pointerId);
        redraw();
        return;
      }
      if (transformStartRef.current) {
        const t = transformStartRef.current;
        if (t.mode === "scale") {
          // Same widthScale bake-in as page.tsx's Free-canvas Scale commit —
          // geometric mean of the two axes so a width-only/height-only
          // stretch doesn't also thicken the ink.
          const widthFactor = Math.sqrt(Math.abs(t.lastScaleX * t.lastScaleY));
          for (const id of t.snapshot.keys()) {
            const idx = strokesRef.current.findIndex((s) => s.id === id);
            if (idx === -1) continue;
            strokesRef.current[idx].widthScale = (strokesRef.current[idx].widthScale ?? 1) * widthFactor;
          }
        }
        const updates = [...t.snapshot.keys()].flatMap((id) => {
          const s = strokesRef.current.find((s) => s.id === id);
          return s ? [{ id, points: s.points, widthScale: s.widthScale }] : [];
        });
        onStrokesChangeRef.current(updates);
        transformStartRef.current = null;
        canvas!.releasePointerCapture(e.pointerId);
        redraw();
        return;
      }
      if (LASSO_TOOLS.has(toolRef.current)) {
        const polygon = lassoRef.current;
        const matched = strokesRef.current
          .filter((s) => anyPointInPolygon(s.points.map((p) => [p[0], p[1]]) as [number, number][], polygon))
          .map((s) => s.id);
        selectedIdsRef.current = new Set(matched);
        lassoRef.current = [];
      } else {
        if (drawingRef.current && pointsRef.current.length > 1) {
          onStrokeCompleteRef.current(
            {
              id: `${Date.now()}-${Math.round(Math.random() * 1e6)}`,
              points: pointsRef.current,
              createdAt: Date.now(),
              kind: toolRef.current === "brush" ? "brush" : "pen",
            },
            canvas!.clientWidth,
            canvas!.clientHeight,
            Math.max(0, Date.now() - strokeStartTimeRef.current)
          );
        }
      }
      drawingRef.current = false;
      pointsRef.current = [];
      canvas!.releasePointerCapture(e.pointerId);
      redraw();
    }

    // Delete/Backspace removes whatever's selected in THIS cell — a no-op
    // everywhere else, since selectedIdsRef is empty unless the user just
    // lasso-selected here. Guarded against typing in any input (e.g. the
    // context bar's own Dimension field) the same way page.tsx's shortcuts
    // are, so editing a number doesn't also wipe strokes.
    function onKeyDown(e: KeyboardEvent) {
      // Copy/Paste — shares src/lib/clipboard.ts with page.tsx's Free-canvas
      // handler, so content can cross between Free and any Grid cell. Grid
      // has no vector shapes (Free-only, see FREE_ONLY_TOOLS in page.tsx),
      // so only `clip.strokes` is ever read here.
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "c") {
        const target = e.target as HTMLElement | null;
        if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
        // Same reasoning as the focus-guard on Paste below: a stale
        // selection can linger in a cell the user isn't in anymore (nothing
        // auto-clears it just from clicking into a different cell).
        if (document.activeElement !== canvas || selectedIdsRef.current.size === 0) return;
        e.preventDefault();
        const strokes: ClipboardStroke[] = strokesRef.current
          .filter((s) => selectedIdsRef.current.has(s.id))
          .map((s) => ({
            points: s.points.map((p) => [...p] as StrokePoint),
            kind: s.kind,
            widthScale: s.widthScale,
            source: { cellWidth: cellDimsRef.current.width, cellHeight: cellDimsRef.current.height },
          }));
        setClipboard({ strokes, shapes: [] });
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "v") {
        const target = e.target as HTMLElement | null;
        if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
        // Every cell shares this same window-level listener — only the one
        // the user actually clicked into (DOM focus, set in onPointerDown
        // above) should paste, or Cmd+V would land in every visible cell.
        if (document.activeElement !== canvas) return;
        const clip = getClipboard();
        if (!clip || clip.strokes.length === 0) return;
        e.preventDefault();
        const { width: targetWidth, height: targetHeight } = cellDimsRef.current;
        for (const cs of clip.strokes) {
          let points = cs.points;
          if (cs.source === "free") {
            const flat = points.map(([x, y]) => [x, y] as [number, number]);
            const { scale, offsetX, offsetY } = fitPointsToBox(flat, targetWidth, targetHeight);
            points = points.map(([x, y, p]) => [x * scale + offsetX, y * scale + offsetY, p] as StrokePoint);
          } else {
            const scaleX = targetWidth / cs.source.cellWidth;
            const scaleY = targetHeight / cs.source.cellHeight;
            points = points.map(([x, y, p]) => [x * scaleX, y * scaleY, p] as StrokePoint);
          }
          onStrokeCompleteRef.current(
            { id: `${Date.now()}-${Math.round(Math.random() * 1e6)}`, points, createdAt: Date.now(), kind: cs.kind },
            targetWidth,
            targetHeight,
            0
          );
        }
        redraw();
        return;
      }

      if (selectedIdsRef.current.size === 0) return;
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
      e.preventDefault();
      onEraseRef.current(selectedIdsRef.current);
      selectedIdsRef.current = new Set();
      redraw();
    }

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerUp);
    window.addEventListener("keydown", onKeyDown);

    return () => {
      resizeObserver.disconnect();
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerUp);
      window.removeEventListener("keydown", onKeyDown);
    };
    // Mount once per cell; outlines/onStrokeComplete/metrics/bearings are read
    // via refs above so redraws after a parent re-render don't need to tear
    // down listeners.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Leaving a selection-based tool drops whatever was selected/being edited
  // in this cell — same "tool switch clears working state" rule as Free's
  // own [drawTool] effect in page.tsx.
  useEffect(() => {
    if (!SELECTION_TOOLS.has(tool)) selectedIdsRef.current = new Set();
    if (tool !== "nudge") {
      editingStrokeIdRef.current = null;
      anchorIndicesRef.current = [];
      resampledRef.current = false;
      draggingAnchorRef.current = null;
    }
    transformStartRef.current = null;
    redrawRef.current();
  }, [tool]);

  useEffect(() => {
    // Don't fight an active Nudge/Move/Rotate/Scale edit with a redraw driven
    // by (now-stale, until the edit commits) props — same reasoning as the
    // strokesRef sync guard above.
    if (editingStrokeIdRef.current !== null || transformStartRef.current !== null) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawGuides(ctx, canvas.clientWidth, canvas.clientHeight, metrics, leftBearing, rightBearing);
    for (const s of strokes) {
      const color = selectedIdsRef.current.has(s.id) ? SELECTED_COLOR : CELL_COLOR;
      fillOutline(ctx, outlineFor(s.points, effectiveOptionsFor(s, strokeOptions)), color);
    }
  }, [strokes, metrics, leftBearing, rightBearing, strokeOptions]);

  const unicode = unicodeFor(label);

  // Drags the wrapper's own width directly (not through React state) for a
  // smooth live resize — the canvas inside already has a ResizeObserver
  // (see the mount effect above) that reacts to exactly this kind of
  // layout-driven size change, so it keeps redrawing at the right size for
  // free. Only the FINAL width, on release, goes back up to the parent —
  // that's the one moment a glyph's widthRatio actually needs to change.
  const widthDragRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const widthHandleRef = useRef<HTMLDivElement | null>(null);

  // Whether this cell HAS a glyph (and so has anything to persist a resize
  // into) is only known once glyphs have loaded from localStorage — empty
  // during SSR, populated before the client's first paint. Deriving the
  // handle's disabled look directly in JSX would make that attribute itself
  // mismatch between server and client markup; setting it imperatively here
  // (client-only, post-hydration) sidesteps that entirely — the JSX below
  // never renders a style attribute for this element at all.
  useEffect(() => {
    const el = widthHandleRef.current;
    if (!el) return;
    el.style.pointerEvents = onWidthCommit ? "auto" : "none";
    el.style.opacity = onWidthCommit ? "1" : "0";
  }, [onWidthCommit]);

  function handleWidthPointerDown(e: React.PointerEvent) {
    e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    widthDragRef.current = {
      startX: e.clientX,
      startWidth: wrapperRef.current?.getBoundingClientRect().width ?? widthPx,
    };
  }

  function handleWidthPointerMove(e: React.PointerEvent) {
    if (!widthDragRef.current || !wrapperRef.current) return;
    const delta = e.clientX - widthDragRef.current.startX;
    const newWidth = Math.max(30, widthDragRef.current.startWidth + delta);
    wrapperRef.current.style.width = `${newWidth}px`;
  }

  function handleWidthPointerUp(e: React.PointerEvent) {
    if (!widthDragRef.current || !wrapperRef.current) return;
    widthDragRef.current = null;
    (e.target as Element).releasePointerCapture(e.pointerId);
    onWidthCommit?.(wrapperRef.current.getBoundingClientRect().width);
  }

  return (
    <div className={styles.gridCell} ref={wrapperRef} style={{ width: widthPx, height: heightPx }}>
      <canvas ref={canvasRef} className={styles.gridCellCanvas} tabIndex={-1} style={{ outline: "none" }} />
      <div className={styles.gridCellLabelBar}>
        <span className={styles.gridCellLabelChar}>{label}</span>
        {unicode && <span className={styles.gridCellLabelUnicode}>{unicode}</span>}
      </div>
      {/* Always rendered (never conditional on whether a glyph exists) —
          glyphs load from localStorage, which is empty during SSR and
          populated by the time the client hydrates, so gating this node's
          presence (or its style — see the effect above) on that would
          mismatch server/client output. Disabled when there's no glyph:
          nothing to resize in an empty cell, and no onWidthCommit to
          persist it into anyway. */}
      <div
        ref={widthHandleRef}
        className={styles.gridCellWidthHandle}
        onPointerDown={handleWidthPointerDown}
        onPointerMove={handleWidthPointerMove}
        onPointerUp={handleWidthPointerUp}
        onDoubleClick={(e) => {
          e.stopPropagation();
          onWidthReset?.();
        }}
        title="Drag to resize this glyph's cell — double-click to reset"
      />
    </div>
  );
}
