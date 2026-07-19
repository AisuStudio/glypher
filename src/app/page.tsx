"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { getStroke } from "perfect-freehand";
import styles from "./page.module.css";
import { clearStrokes, loadStrokes, saveStrokes, type Stroke, type StrokePoint } from "@/lib/strokes";
import { loadGlyphs, saveGlyphs, unicodeFor, type Glyph, type GlyphKind } from "@/lib/glyphs";
import { anyPointInPolygon, pointInPolygon } from "@/lib/geometry";
import { outlineToPath, pathToSvgD, skeletonToPath, unionOutlines, type PathCommand } from "@/lib/contour";
import { simplifyStrokeIndices } from "@/lib/simplify";
import { buildFont, downloadFont } from "@/lib/exportFont";
import { downloadSkeletonSvg } from "@/lib/exportSkeleton";
import { saveFile } from "@/lib/saveFile";
import { loadMetrics, saveMetrics, DEFAULT_METRICS, type Metrics } from "@/lib/metrics";
import { loadSettings, saveSettings, DEFAULT_SETTINGS, type StrokeSettings } from "@/lib/settings";
import { downloadProjectFile, parseProjectFile, applyProjectFile } from "@/lib/projectFile";
import { layoutText } from "@/lib/layoutText";
import {
  Undo2,
  Redo2,
  Pencil,
  Brush,
  Eraser,
  BookA,
  SplinePointer,
  MousePointer2,
  Lasso,
  Move,
  RotateCw,
  Scaling,
  Hand,
} from "lucide-react";
import GridCell, { DEFAULT_LEFT_BEARING, DEFAULT_RIGHT_BEARING, type CellTool } from "./GridCell";
import BetaBadge from "./BetaBadge";
import { CHARACTER_SETS, DEFAULT_CHARACTER_SET_IDS } from "@/lib/charsets";
import AnimatePanel from "./AnimatePanel";
import EditorPanel, { DEFAULT_EDITOR_FONT_SIZE_PT } from "./EditorPanel";
import { DEFAULT_PRESET_ID, type AnimationPresetId } from "@/lib/animationPresets";
import { trackPageview, trackDuration, trackExport } from "@/lib/analytics";
import {
  getAuthorId,
  getDraftId,
  rollDraftId,
  summarizeStroke,
  enqueueProvenanceEvent,
  flushProvenanceQueue,
  flushProvenanceQueueAndWait,
} from "@/lib/provenance";

// Draw has three styles: Free (the old "Write" freeform canvas), Grid (one
// glyph per cell), and Editor (compose/preview text using already-tagged
// glyphs — no drawing of its own yet).
type TopMode = "draw" | "animate";
type DrawStyle = "free" | "grid" | "editor";
// Nudge and Assign only ever apply to Free — reshaping a Grid cell's
// single-letter stroke via anchors, or lasso-tagging a stroke to a glyph,
// isn't the point of the Grid/Editor views (Grid already tags a stroke to
// its glyph the moment it's drawn, so there's nothing to assign there).
// Select is the bare lasso gesture Move/Rotate/Scale below all read from —
// Assign keeps the exact same gesture plus its own tag-form panel, so the
// two share the lasso code paths (see LASSO_TOOLS) rather than duplicating
// them.
type DrawTool = "pen" | "brush" | "eraser" | "nudge" | "anchor" | "assign" | "select" | "move" | "rotate" | "scale" | "pan";
// The 5 menu-bar dropdowns — "charset" (the Grid context bar's Character
// sets picker) is a separate, click-only dropdown, not part of the hover
// group below.
type MenuKey = "glypher" | "file" | "edit" | "view" | "tools" | "marketplace" | "charset";
// One entry per Grid cell — the fixed character sets contribute one slot
// per character (kind always "base"), and a user can append arbitrary extra
// slots (ligatures, alternates, or a one-off base symbol outside any set) via
// the Character Sets dropdown's "Add glyph" form. A slot only describes what
// cell to show and, for a brand-new glyph, what to tag it as on first stroke
// (see handleGridStroke) — components/alternateOf are otherwise unused once
// the underlying Glyph already exists.
type GridSlot = { name: string; kind: GlyphKind; components?: string[]; alternateOf?: string };
// Tools whose pointerdown-through-pointerup gesture on empty/stroke space is
// "drag out a lasso and replace selectedIds with whatever it enclosed".
const LASSO_TOOLS = new Set<DrawTool>(["assign", "select"]);
// Tools that read (rather than replace) the current selection — switching
// among these must NOT clear selectedIds, unlike switching to pen/eraser/
// nudge/pan, which should.
const SELECTION_TOOLS = new Set<DrawTool>(["assign", "select", "move", "rotate", "scale"]);
// Tools whose pointerdown/move/up is a rigid transform (translate/rotate/
// scale) applied to the current selection, via handleTransformPointerDown/
// applyTransform below.
const TRANSFORM_TOOLS = new Set<DrawTool>(["move", "rotate", "scale"]);
// Every DrawTool whose button only ever appears when drawStyle==="free" —
// leaving Free resets drawTool back to "pen" if it's one of these, since
// their UI vanishes and a stale value would silently persist otherwise.
// Select/Nudge/Move/Rotate/Scale all work in Grid too (GridCell has its own
// local port of the same select/reshape/transform logic) — only Assign
// (Grid auto-tags on draw, nothing to assign), Pan (a single small fixed
// cell has nothing to pan around), and Anchor (single-anchor select/insert/
// delete — Grid cells are small and already busy with bearing handles) stay
// Free-exclusive.
const FREE_ONLY_TOOLS = new Set<DrawTool>(["assign", "pan", "anchor"]);

// Single source of truth for the sidebar's TOOLS section, the menu bar's
// Tools dropdown, AND the keyboard shortcuts below — one place to add a
// tool so none of the three can drift out of sync with each other.
type ToolDef = { value: DrawTool; label: string; icon: typeof Brush; shortcut: string };
const TOOL_DEFS: ToolDef[] = [
  { value: "pen", label: "Draw", icon: Pencil, shortcut: "b" },
  { value: "brush", label: "Brush", icon: Brush, shortcut: "u" },
  { value: "eraser", label: "Erase", icon: Eraser, shortcut: "e" },
  { value: "select", label: "Select", icon: Lasso, shortcut: "l" },
  { value: "nudge", label: "Nudge", icon: SplinePointer, shortcut: "n" },
  { value: "anchor", label: "Anchor", icon: MousePointer2, shortcut: "p" },
  { value: "move", label: "Move", icon: Move, shortcut: "m" },
  { value: "rotate", label: "Rotate", icon: RotateCw, shortcut: "r" },
  { value: "scale", label: "Scale", icon: Scaling, shortcut: "s" },
  { value: "pan", label: "Pan", icon: Hand, shortcut: "h" },
  { value: "assign", label: "Assign", icon: BookA, shortcut: "a" },
];

// Same idea for the sidebar's VIEWS section and the menu bar's View dropdown
// — a flat list synthesized across the two underlying state variables
// (topMode/drawStyle) that "which view is active" actually spans.
type ViewDef = { key: string; label: string; topMode: TopMode; drawStyle?: DrawStyle };
// Animate is deliberately left out of this list — not far enough along yet
// to expose in the nav — but topMode==="animate" and AnimatePanel itself are
// untouched, so re-adding a { key: "animate", ... } entry here is all it'll
// take to bring it back. Export isn't a view either: it has no view of its
// own to switch into (File's Export FFF/JSON/OTF/Skeleton SVG actions cover
// the whole surface already) — it used to be a JSON-preview panel, but that
// duplicated what File already does and confused "view" with "action".
const VIEW_DEFS: ViewDef[] = [
  { key: "grid", label: "Grid View", topMode: "draw", drawStyle: "grid" },
  { key: "free", label: "Free Draw View", topMode: "draw", drawStyle: "free" },
  { key: "editor", label: "Editor View", topMode: "draw", drawStyle: "editor" },
];

const COLOR_DEFAULT = "#1f1934"; // blueberry — untagged
const COLOR_SELECTED = "#d8ff01"; // lemon — pending selection
const COLOR_TAGGED = "#5100ff"; // grape — assigned to a glyph
const ANCHOR_COLOR = "#5100ff"; // grape — matches the draggable-affordance color used elsewhere (GridCell's bearing handles)
const ANCHOR_RING_COLOR = "#eae8e0"; // vanilla — ring for contrast against the stroke color
const SKELETON_GUIDE_COLOR = "#9e9c95"; // hazelnut
const FREE_RASTER_COLOR = "#FFABAB"; // Free mode's ruled-line background only — not shared with the Nudge skeleton preview or transform pivot line, which stay hazelnut
const ANCHOR_HIT_PX = 8;

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

// A Scale-tool gesture bakes its magnitude into the stroke's own widthScale
// (see applyTransform) so relative thickness stays constant as the shape
// grows/shrinks, instead of every stroke sharing one fixed global size.
function effectiveSettingsFor(stroke: Stroke, settings: StrokeSettings): StrokeSettings {
  const ws = stroke.widthScale ?? 1;
  return ws === 1 ? settings : { ...settings, size: settings.size * ws };
}

// Lowercase letters that dip below the baseline (their body still sits in
// the x-height band, only the tail extends to the descender line) vs. ones
// that reach the ascender line — used to pick which pair of guide lines a
// bbox-fallback glyph's own bounding box gets normalized against below. Any
// name not covered here (uppercase, digits, accented letters, ligatures)
// falls back to the full ascender-to-baseline band.
const DESCENDER_LETTERS = new Set(["g", "j", "p", "q", "y"]);
const ASCENDER_LETTERS = new Set(["b", "d", "f", "h", "k", "l", "t"]);

function bandFor(name: string, metrics: Metrics): { top: number; bottom: number } {
  const isLowerLatin = name.length === 1 && name >= "a" && name <= "z";
  if (isLowerLatin) {
    if (DESCENDER_LETTERS.has(name)) return { top: metrics.xHeight, bottom: metrics.descender };
    if (ASCENDER_LETTERS.has(name)) return { top: metrics.ascender, bottom: metrics.baseline };
    return { top: metrics.xHeight, bottom: metrics.baseline };
  }
  return { top: metrics.ascender, bottom: metrics.baseline };
}

// Glyphs tagged via Free-mode Assign carry raw pen coordinates captured on
// the large Free canvas (e.g. x in the hundreds) — rendered as-is inside a
// Grid cell's own small canvas (~90px), they land far outside the visible
// area. Grid-native glyphs (drawn directly in a cell, cellWidth/cellHeight
// set) are calibrated to that recorded cell size — see fromAnchorSpace/
// toAnchorSpace below for how they're kept in sync when Cell size/width
// changes later. This rescales+recenters a bbox-fallback glyph's combined stroke bbox to
// fit its own letter-appropriate guide band (x-height/ascender/descender —
// a lowercase "a" belongs in the x-height, not stretched up to the full
// ascender height) — same idea as layoutText.ts's bbox-fallback transform
// but centered (a single grid cell isn't part of a text line) and band-aware.
// Returns the computed scale alongside the fitted points — a Free-tagged
// glyph's raw pen coordinates are captured on the large Free canvas (e.g.
// hundreds of px tall), so fitting them into a small Grid cell is always a
// dramatic scale-down. Callers MUST fold this into the stroke's widthScale
// before rendering, or the stroke thickness stays calibrated for the
// original Free-canvas size and renders wildly too thick for the shrunk
// letterforms — the same class of bug fixed for Editor mode's font-size
// scaling (see EditorPanel.tsx's effectiveSettingsFor).
function fitStrokesToCell(
  glyphStrokes: Stroke[],
  glyphName: string,
  cellWidthPx: number,
  cellHeightPx: number,
  metrics: Metrics
): { points: StrokePoint[][]; scale: number } {
  const allPoints = glyphStrokes.flatMap((s) => s.points);
  if (allPoints.length === 0) return { points: glyphStrokes.map(() => []), scale: 1 };
  let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity;
  for (const [x, y] of allPoints) {
    xmin = Math.min(xmin, x); xmax = Math.max(xmax, x);
    ymin = Math.min(ymin, y); ymax = Math.max(ymax, y);
  }
  const h = ymax - ymin || 1;
  const { top, bottom } = bandFor(glyphName, metrics);
  const targetHeight = Math.max((bottom - top) * cellHeightPx, 1);
  const scale = targetHeight / h;
  const bottomPx = bottom * cellHeightPx;
  const offsetY = bottomPx - ymax * scale;
  const w = (xmax - xmin) * scale;
  const offsetX = (cellWidthPx - w) / 2 - xmin * scale;
  return {
    points: glyphStrokes.map((s) =>
      s.points.map((p) => [p[0] * scale + offsetX, p[1] * scale + offsetY, p[2]] as StrokePoint)
    ),
    scale,
  };
}

// A Grid-native glyph's stroke points are stored in the pixel space of
// whatever Cell size/width was current the moment they were drawn (its
// "anchor" — glyph.cellWidth/cellHeight). Without this, changing the
// sliders later would resize the cell but leave existing letters frozen at
// their old pixel size. fromAnchorSpace expands anchor-space points to fill
// however big the cell renders right now (used for display); toAnchorSpace
// is the inverse, converting a freshly-drawn/edited stroke's current-pixel-
// space points back into that same anchor so every stroke of a glyph keeps
// sharing one consistent coordinate system no matter when it was touched.
function fromAnchorSpace(
  points: StrokePoint[],
  anchorWidth: number | undefined,
  anchorHeight: number | undefined,
  currentWidth: number,
  currentHeight: number,
  keepProportions = false
): StrokePoint[] {
  if (!anchorWidth || !anchorHeight || (anchorWidth === currentWidth && anchorHeight === currentHeight)) {
    return points;
  }
  let scaleX = currentWidth / anchorWidth;
  let scaleY = currentHeight / anchorHeight;
  if (keepProportions) scaleX = scaleY = Math.min(scaleX, scaleY);
  return points.map(([x, y, p]) => [x * scaleX, y * scaleY, p] as StrokePoint);
}

// Same scale fromAnchorSpace applies to a glyph's points, but as a single
// number for stroke width — a non-uniform (keepProportions off) X/Y stretch
// has no one "correct" width scale, so this uses the same geometric-mean
// convention as the Scale tool's own widthScale bake-in (page.tsx's
// handleTransformPointerDown), which is symmetric for a pure width- or
// height-only change and a reasonable average otherwise.
function anchorSpaceWidthScale(
  anchorWidth: number | undefined,
  anchorHeight: number | undefined,
  currentWidth: number,
  currentHeight: number,
  keepProportions = false
): number {
  if (!anchorWidth || !anchorHeight) return 1;
  let scaleX = currentWidth / anchorWidth;
  let scaleY = currentHeight / anchorHeight;
  if (keepProportions) scaleX = scaleY = Math.min(scaleX, scaleY);
  return Math.sqrt(Math.abs(scaleX * scaleY));
}

function toAnchorSpace(
  points: StrokePoint[],
  anchorWidth: number | undefined,
  anchorHeight: number | undefined,
  currentWidth: number,
  currentHeight: number,
  keepProportions = false
): StrokePoint[] {
  if (!anchorWidth || !anchorHeight || (anchorWidth === currentWidth && anchorHeight === currentHeight)) {
    return points;
  }
  let scaleX = currentWidth / anchorWidth;
  let scaleY = currentHeight / anchorHeight;
  if (keepProportions) scaleX = scaleY = Math.min(scaleX, scaleY);
  return points.map(([x, y, p]) => [x / scaleX, y / scaleY, p] as StrokePoint);
}

// Pivot for Move/Rotate/Scale: the bounding-box center across every
// currently-selected stroke's points, same shape as fitStrokesToCell's own
// bbox loop above (a single shared box across the whole selection, not one
// per stroke, so a multi-stroke selection transforms as one rigid group).
function selectionPivot(strokes: Stroke[]): { x: number; y: number } {
  const allPoints = strokes.flatMap((s) => s.points);
  let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity;
  for (const [x, y] of allPoints) {
    xmin = Math.min(xmin, x); xmax = Math.max(xmax, x);
    ymin = Math.min(ymin, y); ymax = Math.max(ymax, y);
  }
  return { x: (xmin + xmax) / 2, y: (ymin + ymax) / 2 };
}

// Default Scale anchor (no modifier held): bottom-left of the same bbox
// selectionPivot uses — canvas is y-down, so "bottom" is the max-y edge.
function selectionBottomLeft(strokes: Stroke[]): { x: number; y: number } {
  const allPoints = strokes.flatMap((s) => s.points);
  let xmin = Infinity, ymax = -Infinity;
  for (const [x, y] of allPoints) {
    xmin = Math.min(xmin, x);
    ymax = Math.max(ymax, y);
  }
  return { x: xmin, y: ymax };
}

function applyPath(ctx: CanvasRenderingContext2D, commands: PathCommand[]) {
  for (const c of commands) {
    if (c.type === "M") ctx.moveTo(c.x, c.y);
    else if (c.type === "Q") ctx.quadraticCurveTo(c.cx, c.cy, c.x, c.y);
    else if (c.type === "L") ctx.lineTo(c.x, c.y);
    else ctx.closePath();
  }
}

function fillOutline(ctx: CanvasRenderingContext2D, outline: [number, number][], color: string) {
  if (outline.length < 3) return;
  // Shares outlineToPath with the SVG export (src/lib/contour.ts) so the canvas
  // rendering and the exported document always describe the same curve.
  ctx.beginPath();
  applyPath(ctx, outlineToPath(outline));
  ctx.fillStyle = color;
  ctx.fill();
}

// The shared editable document: every glyph resolved to its actual contours (SVG
// path data, one per stroke), plus the identity/relationship fields from Phase 2.
// This is what a later export step (SVG + .fea, or a direct fontTools compile)
// would consume — nothing here writes anywhere, it's just compiled on demand.
function compileDocument(glyphs: Glyph[], strokes: Stroke[], settings: StrokeSettings, metrics: Metrics) {
  const byId = new Map(strokes.map((s) => [s.id, s]));
  return {
    version: 1,
    settings: optionsFor(settings),
    metrics,
    glyphs: glyphs.map((g) => ({
      name: g.name,
      kind: g.kind,
      unicode: g.unicode,
      components: g.components,
      alternateOf: g.alternateOf,
      leftBearing: g.leftBearing,
      rightBearing: g.rightBearing,
      cellWidth: g.cellWidth,
      cellHeight: g.cellHeight,
      // Strokes are drawn independently and can overlap (e.g. the crossbar
      // and stem of a "t") — union their outlines into clean, non-
      // overlapping contours before exporting, so overlapping/self-
      // intersecting paths don't glitch in font rasterizers downstream.
      contours: unionOutlines(
        g.strokeIds
          .map((id) => byId.get(id))
          .filter((s): s is Stroke => Boolean(s))
          .map((s) => outlineFor(s.points, effectiveSettingsFor(s, settings)))
      ).map((ring) => pathToSvgD(outlineToPath(ring))),
    })),
  };
}

// Grid View's cells use a fixed 16:9 height-to-cellSize ratio (see the
// cellHeightPx computation below).
const CELL_ASPECT_RATIO = 16 / 9;

// Free mode's background: plain, evenly-spaced ruled lines, not tied to any
// glyph metrics — just a spatial reference the user can space out via one
// slider. (An earlier version reused Grid View's Ascender/X-height/Baseline/
// Descender guides here, but four differently-styled lines per row read as
// confusing when there's no per-glyph cell to anchor them to.)
function drawLineRaster(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  spacing: number,
  panX: number,
  panY: number
) {
  if (spacing <= 0) return;
  ctx.save();
  ctx.lineWidth = 1;
  ctx.strokeStyle = FREE_RASTER_COLOR;
  ctx.beginPath();
  // Lines are drawn in the already ctx.translate(panX, panY)'d space (see
  // redraw()), so the on-screen viewport actually spans local y from -panY
  // to height - panY — not [0, height] — once the user has panned. Looping
  // over the untranslated canvas rect left the raster behind after a big
  // enough pan; this keeps it tiled across whatever's actually visible.
  const firstY = Math.floor(-panY / spacing) * spacing;
  const lastY = height - panY;
  for (let y = firstY; y <= lastY; y += spacing) {
    const ly = Math.round(y) + 0.5;
    ctx.moveTo(-panX, ly);
    ctx.lineTo(width - panX, ly);
  }
  ctx.stroke();
  ctx.restore();
}

function strokeLassoPath(ctx: CanvasRenderingContext2D, points: [number, number][]) {
  if (points.length < 2) return;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i][0], points[i][1]);
  ctx.closePath();
  ctx.setLineDash([6, 4]);
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = COLOR_TAGGED;
  ctx.stroke();
  ctx.restore();
}

export default function Home() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fffInputRef = useRef<HTMLInputElement | null>(null);
  const drawingRef = useRef(false);
  // Wall-clock start of the current drag gesture — the one piece of timing
  // info a completed Stroke's points don't carry themselves, needed for the
  // provenance event's durationMs (see src/lib/provenance.ts).
  const strokeStartTimeRef = useRef(0);

  // Completed strokes + their cached outlines (recomputed only when a stroke is added
  // or settings change — not on every pointer move).
  const completedRef = useRef<Stroke[]>([]);
  const outlinesRef = useRef<[number, number][][]>([]);
  const currentPointsRef = useRef<StrokePoint[]>([]);
  const lassoRef = useRef<[number, number][]>([]);
  const redrawRef = useRef<() => void>(() => {});
  // Undo/Redo is a full snapshot stack (strokes + glyphs together, since a
  // deletion/reshape can also create/orphan a glyph) — not just "remove the
  // last added stroke," which is all the previous model could do. That
  // meant Eraser/Delete-key/Nudge/Move/Rotate/Scale were all immediate and
  // permanent; every one of those now pushes a pre-mutation snapshot here
  // instead, so any of them can be undone the same way a new stroke can.
  const undoStackRef = useRef<{ strokes: Stroke[]; glyphs: Glyph[] }[]>([]);
  const redoStackRef = useRef<{ strokes: Stroke[]; glyphs: Glyph[] }[]>([]);
  const glyphsRef = useRef<Glyph[]>([]);
  const undoRef = useRef<() => void>(() => {});
  const redoRef = useRef<() => void>(() => {});

  const [topMode, setTopMode] = useState<TopMode>("draw");
  const [drawStyle, setDrawStyle] = useState<DrawStyle>("grid");

  // Menu bar dropdown (Fontane/File/Edit/View/Tools) — dismissed by the
  // outside-click listener below.
  const [openMenu, setOpenMenu] = useState<MenuKey | null>(null);
  // Hover-to-open for the menu bar: a short close delay (not an instant
  // setOpenMenu(null) on mouseleave) so the pointer can travel from the
  // trigger down into the dropdown panel across the small visual gap
  // between them without it flickering shut mid-move. Any new hover — the
  // same item again, or a different one — cancels a pending close.
  const menuHoverCloseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  function openMenuOnHover(key: MenuKey) {
    if (menuHoverCloseTimeoutRef.current !== null) {
      clearTimeout(menuHoverCloseTimeoutRef.current);
      menuHoverCloseTimeoutRef.current = null;
    }
    setOpenMenu(key);
  }
  function scheduleMenuHoverClose() {
    menuHoverCloseTimeoutRef.current = setTimeout(() => {
      setOpenMenu(null);
      menuHoverCloseTimeoutRef.current = null;
    }, 200);
  }
  // Info/How-to modal, opened from the Fontane menu — a plain overlay
  // rather than another dropdown, since this content is paragraph-length,
  // not a short action list.
  const [infoModal, setInfoModal] = useState<"info" | "howto" | null>(null);
  // File > New File's "save first?" confirmation — same modal pattern as
  // infoModal, just a yes/no instead of paragraph content.
  const [confirmNewFile, setConfirmNewFile] = useState(false);

  // Marketplace: Publish Font / Share Font both live in the same lightweight
  // modal pattern as infoModal. Publish's fields reset via
  // closeMarketplaceModal() below rather than persisting across opens.
  const [marketplaceModal, setMarketplaceModal] = useState<"publish" | "share" | null>(null);
  const [publishName, setPublishName] = useState("");
  const [publishAuthorName, setPublishAuthorName] = useState("");
  const [publishAuthorUrl, setPublishAuthorUrl] = useState("");
  const [slugCheck, setSlugCheck] = useState<{ slug: string; available: boolean } | null>(null);
  const [slugChecking, setSlugChecking] = useState(false);
  const [licenseAccepted, setLicenseAccepted] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [publishedSlug, setPublishedSlug] = useState<string | null>(null);
  const [shareQuery, setShareQuery] = useState("");
  const [shareResults, setShareResults] = useState<{ slug: string; display_name: string }[]>([]);
  const [shareSearching, setShareSearching] = useState(false);
  const [shareCopyState, setShareCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const [shareCopiedSlug, setShareCopiedSlug] = useState<string | null>(null);

  // Debounced live availability check while typing a name in the Publish
  // modal — UX feedback only, api/fonts/publish re-checks server-side before
  // actually writing anything (see that route's comment).
  useEffect(() => {
    if (marketplaceModal !== "publish") return;
    const trimmed = publishName.trim();
    if (!trimmed) {
      // Must clear a stale "available" result synchronously here (not just
      // let the debounced fetch below overwrite it) — handlePublish() reads
      // slugCheck?.available as its guard, so an empty name that still held
      // a prior success would otherwise stay publishable.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSlugCheck(null);
      setSlugChecking(false);
      return;
    }
    setSlugChecking(true);
    const handle = setTimeout(() => {
      fetch(`/api/fonts/check-slug?name=${encodeURIComponent(trimmed)}`)
        .then((r) => r.json())
        .then((data) => setSlugCheck(data.error ? null : { slug: data.slug, available: data.available }))
        .catch(() => setSlugCheck(null))
        .finally(() => setSlugChecking(false));
    }, 400);
    return () => clearTimeout(handle);
  }, [publishName, marketplaceModal]);

  // Debounced search backing the Share Font modal.
  useEffect(() => {
    if (marketplaceModal !== "share") return;
    const trimmed = shareQuery.trim();
    if (!trimmed) {
      // Clears stale results synchronously so a cleared search box can't
      // still show the previous query's matches for a frame.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setShareResults([]);
      setShareSearching(false);
      return;
    }
    setShareSearching(true);
    const handle = setTimeout(() => {
      fetch(`/api/fonts/search?q=${encodeURIComponent(trimmed)}`)
        .then((r) => r.json())
        .then((data) => setShareResults(data.results ?? []))
        .catch(() => setShareResults([]))
        .finally(() => setShareSearching(false));
    }, 300);
    return () => clearTimeout(handle);
  }, [shareQuery, marketplaceModal]);
  const [activeSetIds, setActiveSetIds] = useState<Set<string>>(new Set(DEFAULT_CHARACTER_SET_IDS));
  // Extra Grid cells beyond the fixed character sets — this is the only way
  // to get a ligature/alternate slot into Grid view at all (Free mode's
  // Assign panel already supports both kinds via lasso-tagging; Grid drawing
  // fuses capture+tagging per cell, so it needs its own slot list instead).
  const [extraGridSlots, setExtraGridSlots] = useState<GridSlot[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const raw = window.localStorage.getItem("fontane.extraGridSlots.v1");
      return raw ? (JSON.parse(raw) as GridSlot[]) : [];
    } catch {
      return [];
    }
  });

  function addGridSlot(slot: GridSlot) {
    // A "base" name already covered by an active fixed set would collide
    // with that set's own cell (same kind+name → same React key, same
    // glyph lookup) — silently skip rather than render a duplicate cell.
    const collidesWithFixedSet =
      slot.kind === "base" && CHARACTER_SETS.some((s) => activeSetIds.has(s.id) && s.chars.includes(slot.name));
    if (collidesWithFixedSet) return;
    setExtraGridSlots((prev) => {
      if (prev.some((s) => s.name === slot.name && s.kind === slot.kind)) return prev;
      const next = [...prev, slot];
      window.localStorage.setItem("fontane.extraGridSlots.v1", JSON.stringify(next));
      return next;
    });
  }

  // Only removes the cell from Grid's visible slot list — the underlying
  // Glyph and its strokes (if any were drawn) are untouched, so re-adding
  // the same name+kind later picks up right where it left off.
  function removeGridSlot(name: string, kind: GlyphKind) {
    setExtraGridSlots((prev) => {
      const next = prev.filter((s) => !(s.name === name && s.kind === kind));
      window.localStorage.setItem("fontane.extraGridSlots.v1", JSON.stringify(next));
      return next;
    });
  }

  const [metrics, setMetrics] = useState<Metrics>(() => loadMetrics());
  const [cellSize, setCellSize] = useState(() => {
    if (typeof window === "undefined") return 90;
    return Number(window.localStorage.getItem("fontane.cellSize.v1") ?? window.localStorage.getItem("glypher.cellSize.v1")) || 90;
  });

  function updateCellSize(size: number) {
    setCellSize(size);
    window.localStorage.setItem("fontane.cellSize.v1", String(size));
  }

  // A ratio, not an absolute pixel value — wide letters like "m" or "@" need
  // more horizontal room than tall/narrow ones, but letting width and height
  // be two fully independent absolute sizes made cells too easy to stretch
  // into arbitrary, hard-to-control shapes. Width stays a proportion of
  // cellSize instead, so "Cell size" alone still scales the whole cell
  // proportionally, and this only adjusts how wide relative to that.
  const [cellWidthRatio, setCellWidthRatio] = useState(() => {
    if (typeof window === "undefined") return 1;
    return Number(window.localStorage.getItem("fontane.cellWidthRatio.v1") ?? window.localStorage.getItem("glypher.cellWidthRatio.v1")) || 1;
  });

  function updateCellWidthRatio(ratio: number) {
    setCellWidthRatio(ratio);
    window.localStorage.setItem("fontane.cellWidthRatio.v1", String(ratio));
  }

  // When on, fromAnchorSpace/toAnchorSpace rescale a Grid glyph uniformly
  // (the smaller of the two axis ratios, applied to both) instead of
  // independently per axis — so changing Cell size/Width never stretches or
  // squeezes an already-drawn glyph's own proportions.
  const [keepProportions, setKeepProportions] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem("fontane.keepProportions.v1") === "true";
  });

  function updateKeepProportions(value: boolean) {
    setKeepProportions(value);
    window.localStorage.setItem("fontane.keepProportions.v1", String(value));
  }

  const cellWidth = cellSize * cellWidthRatio;

  // Each GridCell's own actual rendered size, keyed by letter — the label
  // bar under the canvas eats some of the grid row's nominal height (see
  // GridCell's onResize), so cellWidth/cellHeightPx alone don't match what a
  // cell's canvas really measures. Falls back to the nominal values below
  // until a cell has reported in at least once (first paint).
  const [cellDims, setCellDims] = useState<Record<string, { width: number; height: number }>>({});

  function handleCellResize(cellKey: string, width: number, height: number) {
    setCellDims((prev) => {
      const existing = prev[cellKey];
      if (existing && existing.width === width && existing.height === height) return prev;
      return { ...prev, [cellKey]: { width, height } };
    });
  }

  // Free mode's ruled-line background — independent of Grid View's cellSize,
  // since the two rasters serve different purposes (a plain spatial
  // reference vs. per-glyph type metrics).
  const [lineSpacing, setLineSpacing] = useState(() => {
    if (typeof window === "undefined") return 75;
    return Number(window.localStorage.getItem("fontane.lineSpacing.v1") ?? window.localStorage.getItem("glypher.lineSpacing.v1")) || 75;
  });

  function updateLineSpacing(spacing: number) {
    setLineSpacing(spacing);
    window.localStorage.setItem("fontane.lineSpacing.v1", String(spacing));
  }

  const [editorText, setEditorText] = useState(() => {
    if (typeof window === "undefined") return "";
    return window.localStorage.getItem("fontane.editorText.v1") ?? window.localStorage.getItem("glypher.editorText.v1") ?? "";
  });

  function updateEditorText(text: string) {
    setEditorText(text);
    window.localStorage.setItem("fontane.editorText.v1", text);
  }

  const [editorFontSize, setEditorFontSize] = useState(() => {
    if (typeof window === "undefined") return DEFAULT_EDITOR_FONT_SIZE_PT;
    return Number(window.localStorage.getItem("fontane.editorFontSize.v1") ?? window.localStorage.getItem("glypher.editorFontSize.v1")) || DEFAULT_EDITOR_FONT_SIZE_PT;
  });

  function updateEditorFontSize(pt: number) {
    setEditorFontSize(pt);
    window.localStorage.setItem("fontane.editorFontSize.v1", String(pt));
  }

  // Off by default — Editor's char-by-char composition already matches what
  // most tagged glyphs are (kind:"base"); substituting a run like "fi" for a
  // tagged ligature is a deliberate opt-in, not assumed.
  const [useLigatures, setUseLigatures] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem("fontane.useLigatures.v1") === "true";
  });

  function updateUseLigatures(value: boolean) {
    setUseLigatures(value);
    window.localStorage.setItem("fontane.useLigatures.v1", String(value));
  }

  function toggleCharacterSet(id: string) {
    setActiveSetIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function updateMetric(key: keyof Metrics, value: number) {
    setMetrics((prev) => {
      const next = { ...prev, [key]: value };
      saveMetrics(next);
      return next;
    });
  }

  const topModeRef = useRef(topMode);
  const drawStyleRef = useRef(drawStyle);
  // Editor has no stroke settings/tools of its own yet (Phase 1 is
  // read-only composition) — Free and Grid still get the full Pen/Eraser/
  // Nudge + stroke-appearance controls.
  const showStrokeControls = topMode === "draw" && drawStyle !== "editor";

  const [drawTool, setDrawTool] = useState<DrawTool>("pen");
  const drawToolRef = useRef(drawTool);

  // Nudge tool: which stroke is currently being reshaped, its anchor
  // indices (Douglas-Peucker-simplified — see src/lib/simplify.ts), whether
  // this session's stroke has already been resampled down to just those
  // anchors (only happens once, lazily, on the first anchor drag — see the
  // comment at the drag-start site), and which anchor is mid-drag. All refs,
  // not state: redraw() is called explicitly after every mutation here,
  // same as the rest of this canvas's pointer-driven state.
  const editingStrokeIdRef = useRef<string | null>(null);
  const anchorIndicesRef = useRef<number[]>([]);
  const resampledRef = useRef(false);
  const draggingAnchorRef = useRef<number | null>(null);

  // Anchor tool: a SINGLE anchor persistently selected (highlighted) on the
  // currently-edited stroke — unlike draggingAnchorRef above, this survives
  // pointerup, and is what Delete/Backspace acts on. Stores the anchor's
  // RANK (its position within anchorIndicesRef), not a raw point index —
  // rank stays meaningful across the lazy resample-to-anchors-only collapse
  // (which reorders storage but not which anchors exist or their order),
  // whereas a raw index captured before that resample would go stale.
  const selectedAnchorRef = useRef<{ strokeId: string; rank: number } | null>(null);

  // Move/Rotate/Scale: a snapshot of every selected stroke's points taken at
  // gesture start, plus the pivot (bbox center) and start pointer position —
  // every pointermove recomputes from this frozen snapshot rather than the
  // live (already-mutated) points, same "read pre-drag state, write pointer
  // position" shape as Nudge's anchor drag above, just applied to a whole
  // selection instead of one anchor. null when no such gesture is active.
  const transformStartRef = useRef<{
    mode: "move" | "rotate" | "scale";
    pivotX: number;
    pivotY: number;
    startX: number;
    startY: number;
    startDist: number;
    startAngle: number;
    // Signed per-axis start offsets from the anchor — lets Scale compute
    // independent (non-uniform) x/y ratios; startDist/startAngle above stay
    // for Rotate and for Shift-locked (uniform) Scale.
    startDx: number;
    startDy: number;
    // Shift-locked at gesture start (see handleTransformPointerDown) rather
    // than re-read live, so toggling Shift mid-drag can't suddenly snap an
    // already-diverged non-uniform scale back to square.
    uniform: boolean;
    // Last scaleX/scaleY applied by applyTransform — read once at pointerup
    // to bake this gesture's magnitude into the scaled strokes' widthScale.
    lastScaleX: number;
    lastScaleY: number;
    snapshot: Map<string, StrokePoint[]>;
    // Updated every pointermove by applyTransform so redraw() can paint a
    // pivot dot + guide line without redraw() itself needing the live
    // pointer position passed in some other way.
    currentX: number;
    currentY: number;
  } | null>(null);

  // Pan: panOffsetRef is added to every drawn/read coordinate (see redraw()
  // and pointFromEvent()) so existing strokes appear to scroll; it's a ref,
  // not state, since it must update every pointermove frame without
  // triggering a React re-render. panDragStartRef captures the gesture's own
  // start in raw client coordinates (not world space) to avoid a feedback
  // loop with the offset it's busy mutating.
  const panOffsetRef = useRef({ x: 0, y: 0 });
  const panDragStartRef = useRef<{ clientX: number; clientY: number; offsetX: number; offsetY: number } | null>(null);

  const [settings, setSettings] = useState<StrokeSettings>(() => loadSettings());
  const settingsRef = useRef(settings);
  // Drives Free mode's line raster (see drawLineRaster) — a ref, not a
  // direct state read, since the redraw() that consumes it lives inside
  // the mount-once pointer-handling effect below.
  const lineSpacingRef = useRef(lineSpacing);

  // Lazy initializer, not useEffect + setGlyphs([]) then load: starting from an empty
  // array and loading afterward would let the save-on-change effect below fire once
  // with [] and clobber whatever was already in storage before the real data arrives.
  const [glyphs, setGlyphs] = useState<Glyph[]>(() => loadGlyphs());

  // Every ligature/alternate already tagged (e.g. via Free's Assign panel)
  // gets its own Grid cell automatically — no need to re-declare it via
  // "Add Glyph" just to see/edit it here. Deduped against extraGridSlots by
  // name+kind so a manually-added not-yet-drawn slot doesn't collide with
  // the same slot once a glyph starts existing for it (same key either way).
  const extraSlotKeys = new Set(extraGridSlots.map((s) => `${s.kind}:${s.name}`));
  const taggedSlots: GridSlot[] = glyphs
    .filter((g) => g.kind !== "base" && !extraSlotKeys.has(`${g.kind}:${g.name}`))
    .map((g): GridSlot => ({ name: g.name, kind: g.kind, components: g.components, alternateOf: g.alternateOf }));

  const gridSlots: GridSlot[] = [
    ...CHARACTER_SETS.filter((s) => activeSetIds.has(s.id))
      .flatMap((s) => s.chars)
      .map((name): GridSlot => ({ name, kind: "base" })),
    ...taggedSlots,
    ...extraGridSlots,
  ];
  const taggedIdsRef = useRef<Set<string>>(new Set());
  // Strokes belonging to a Grid-native glyph (cellWidth/cellHeight set) live in
  // Grid-cell-local coordinate space, not Free-canvas space — Free's redraw()
  // must skip them or they paint as a stray blob near the Free canvas origin.
  const gridNativeStrokeIdsRef = useRef<Set<string>>(new Set());

  // Which typed characters in Editor mode have no tagged glyph yet — shown
  // in the dark settings panel alongside the Size control, not inside
  // EditorPanel itself (which only owns the canvas + its hidden input).
  const missingEditorGlyphs = useMemo(() => {
    const all = new Set<string>();
    for (const line of editorText.split("\n")) {
      for (const c of layoutText(line, glyphs, completedRef.current, metrics, useLigatures).missing) all.add(c);
    }
    return [...all];
  }, [editorText, glyphs, metrics, useLigatures]);

  // Collapsed by default — a couple dozen tagged glyphs otherwise pushes the
  // canvas most of the way off-screen. Not persisted: a fresh page load
  // always starts collapsed, same as any other "peek, then expand" panel.
  const [glyphListExpanded, setGlyphListExpanded] = useState(false);

  // Shown once, the first time Free Draw is ever opened — dismissed
  // permanently via localStorage, same pattern as every other one-time flag
  // in this file (not a real "first session" check, just "has Start ever
  // been clicked").
  const [freeDrawIntroDismissed, setFreeDrawIntroDismissed] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem("fontane.seenFreeDrawIntro.v1") === "true";
  });

  function dismissFreeDrawIntro() {
    setFreeDrawIntroDismissed(true);
    window.localStorage.setItem("fontane.seenFreeDrawIntro.v1", "true");
  }

  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const selectedIdsRef = useRef<Set<string>>(new Set());

  // Skew H/V: a live shear (not a drag gesture) applied to the current
  // selection around its bbox center. Both sliders recompute from ONE frozen
  // pre-skew snapshot each time (never from the already-sheared points), so
  // the two axes combine cleanly and repeated small slider ticks don't drift.
  // Snapshot is retaken (and both angles reset to 0) whenever the selection
  // itself changes — skew is always relative to "the selection as it is now".
  const [skewH, setSkewH] = useState(0);
  const [skewV, setSkewV] = useState(0);
  const skewSnapshotRef = useRef<{ pivotX: number; pivotY: number; snapshot: Map<string, StrokePoint[]> } | null>(
    null
  );
  const skewUndoPushedRef = useRef(false);

  const [animateText, setAnimateText] = useState("");
  const [animatePresetId, setAnimatePresetId] = useState<AnimationPresetId>(DEFAULT_PRESET_ID);

  const [nameInput, setNameInput] = useState("");
  const [kindInput, setKindInput] = useState<GlyphKind>("base");
  const [componentsInput, setComponentsInput] = useState("");
  const [alternateOfInput, setAlternateOfInput] = useState("");

  const [hud, setHud] = useState({ pointerType: "—", pressure: 0, x: 0, y: 0 });
  const [strokeCount, setStrokeCount] = useState(0);
  const [undoCount, setUndoCount] = useState(0);
  const [redoCount, setRedoCount] = useState(0);
  const [exportJson, setExportJson] = useState("");
  const [exportDoc, setExportDoc] = useState<ReturnType<typeof compileDocument> | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    function redraw() {
      if (!canvas || !ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      // Pan only ever offsets what's drawn from here on — the grid
      // background pans together with the ink so it still reads as a
      // spatial reference instead of content sliding under a static grid.
      ctx.save();
      ctx.translate(panOffsetRef.current.x, panOffsetRef.current.y);
      drawLineRaster(
        ctx,
        canvas.clientWidth,
        canvas.clientHeight,
        lineSpacingRef.current,
        panOffsetRef.current.x,
        panOffsetRef.current.y
      );
      const strokes = completedRef.current;
      const outlines = outlinesRef.current;
      for (let i = 0; i < strokes.length; i++) {
        if (gridNativeStrokeIdsRef.current.has(strokes[i].id)) continue;
        const color =
          strokes[i].id === editingStrokeIdRef.current
            ? COLOR_SELECTED
            : selectedIdsRef.current.has(strokes[i].id)
              ? COLOR_SELECTED
              : taggedIdsRef.current.has(strokes[i].id)
                ? COLOR_TAGGED
                : COLOR_DEFAULT;
        fillOutline(ctx, outlines[i], color);
      }
      if (!LASSO_TOOLS.has(drawToolRef.current) && currentPointsRef.current.length > 0) {
        fillOutline(ctx, outlineFor(currentPointsRef.current, settingsRef.current), COLOR_DEFAULT);
      }
      if (LASSO_TOOLS.has(drawToolRef.current) && lassoRef.current.length > 1) {
        strokeLassoPath(ctx, lassoRef.current);
      }
      if (TRANSFORM_TOOLS.has(drawToolRef.current) && transformStartRef.current) {
        // A minimal MVP affordance for Rotate/Scale's otherwise-invisible
        // pivot — a dot at the bbox center plus a dashed line out to the
        // cursor — rather than a full bounding-box-with-handles UI this app
        // has never had. Shown for Move too, for visual consistency across
        // all three transform tools even though Move doesn't use the angle/
        // distance the line implies.
        const t = transformStartRef.current;
        ctx.save();
        ctx.setLineDash([4, 3]);
        ctx.lineWidth = 1;
        ctx.strokeStyle = SKELETON_GUIDE_COLOR;
        ctx.beginPath();
        ctx.moveTo(t.pivotX, t.pivotY);
        ctx.lineTo(t.currentX, t.currentY);
        ctx.stroke();
        ctx.restore();
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
      if ((drawToolRef.current === "nudge" || drawToolRef.current === "anchor") && editingStrokeIdRef.current) {
        const stroke = strokes.find((s) => s.id === editingStrokeIdRef.current);
        if (stroke) {
          // The literal "core path" — the raw pen centerline, not the filled
          // perfect-freehand outline — rendered live for the first time
          // anywhere in the app (previously only ever consumed by the
          // static Skeleton SVG export).
          ctx.save();
          ctx.beginPath();
          applyPath(ctx, skeletonToPath(stroke.points.map((p) => [p[0], p[1]] as [number, number])));
          ctx.strokeStyle = SKELETON_GUIDE_COLOR;
          ctx.lineWidth = 1;
          ctx.stroke();
          ctx.restore();

          anchorIndicesRef.current.forEach((idx, rank) => {
            const [ax, ay] = stroke.points[idx];
            const isSelectedAnchor =
              selectedAnchorRef.current?.strokeId === stroke.id && selectedAnchorRef.current?.rank === rank;
            ctx.beginPath();
            ctx.arc(ax, ay, 4, 0, Math.PI * 2);
            ctx.fillStyle = isSelectedAnchor ? COLOR_SELECTED : ANCHOR_COLOR;
            ctx.fill();
            ctx.beginPath();
            ctx.arc(ax, ay, 4, 0, Math.PI * 2);
            ctx.strokeStyle = ANCHOR_RING_COLOR;
            ctx.lineWidth = 0.5;
            ctx.stroke();
          });
        }
      }
      ctx.restore();
    }
    redrawRef.current = redraw;

    function resize() {
      if (!canvas) return;
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      canvas.getContext("2d")?.scale(dpr, dpr);
      redraw();
    }

    // Restore persisted strokes. Glyphs are already loaded via useState's lazy
    // initializer, so just prime the ref the first redraw() below will read.
    completedRef.current = loadStrokes();
    outlinesRef.current = completedRef.current.map((s) => outlineFor(s.points, effectiveSettingsFor(s, settingsRef.current)));
    setStrokeCount(completedRef.current.length);
    taggedIdsRef.current = new Set(glyphs.flatMap((g) => g.strokeIds));
    gridNativeStrokeIdsRef.current = new Set(
      glyphs.filter((g) => g.cellWidth && g.cellHeight).flatMap((g) => g.strokeIds)
    );
    glyphsRef.current = glyphs;

    resize();
    window.addEventListener("resize", resize);

    function pointFromEvent(e: PointerEvent): StrokePoint {
      const rect = canvas!.getBoundingClientRect();
      return [
        e.clientX - rect.left - panOffsetRef.current.x,
        e.clientY - rect.top - panOffsetRef.current.y,
        e.pressure > 0 ? e.pressure : 0.5,
      ];
    }

    function onPointerDown(e: PointerEvent) {
      canvas!.setPointerCapture(e.pointerId);
      const p = pointFromEvent(e);
      setHud({ pointerType: e.pointerType, pressure: e.pressure, x: Math.round(p[0]), y: Math.round(p[1]) });
      if (topModeRef.current === "draw" && drawToolRef.current === "eraser") {
        eraseAt(p[0], p[1]);
        redraw();
        return;
      }
      if (topModeRef.current === "draw" && drawToolRef.current === "nudge") {
        handleNudgePointerDown(p[0], p[1]);
        redraw();
        return;
      }
      if (topModeRef.current === "draw" && drawToolRef.current === "anchor") {
        handleAnchorToolPointerDown(p[0], p[1]);
        redraw();
        return;
      }
      // Pen, while a stroke is already being edited (entered via Anchor or
      // Nudge and kept alive across the tool switch — see the [drawTool]
      // effect): a click on one of its anchors deletes+splits, a click
      // between two anchors inserts one. Otherwise Pen falls through to its
      // normal new-freehand-stroke capture below, unchanged.
      if (topModeRef.current === "draw" && drawToolRef.current === "pen" && editingStrokeIdRef.current) {
        const idx = completedRef.current.findIndex((s) => s.id === editingStrokeIdRef.current);
        if (idx !== -1) {
          const stroke = completedRef.current[idx];
          const rank = anchorNear(p[0], p[1], stroke.points, anchorIndicesRef.current);
          if (rank !== null) {
            deleteAnchorAndSplit(stroke.id, rank);
            redraw();
            return;
          }
          const insertRank = findInsertionRank(p[0], p[1], stroke.points, anchorIndicesRef.current);
          if (insertRank !== null) {
            insertAnchor(stroke.id, insertRank, p[0], p[1]);
            redraw();
            return;
          }
        }
      }
      if (topModeRef.current === "draw" && TRANSFORM_TOOLS.has(drawToolRef.current)) {
        handleTransformPointerDown(p[0], p[1], drawToolRef.current as "move" | "rotate" | "scale", e.altKey, e.shiftKey);
        redraw();
        return;
      }
      if (topModeRef.current === "draw" && drawToolRef.current === "pan") {
        panDragStartRef.current = {
          clientX: e.clientX,
          clientY: e.clientY,
          offsetX: panOffsetRef.current.x,
          offsetY: panOffsetRef.current.y,
        };
        canvas!.style.cursor = "grabbing";
        return;
      }
      drawingRef.current = true;
      strokeStartTimeRef.current = Date.now();
      if (LASSO_TOOLS.has(drawToolRef.current)) {
        lassoRef.current = [[p[0], p[1]]];
      } else {
        currentPointsRef.current = [p];
      }
    }

    function onPointerMove(e: PointerEvent) {
      const p = pointFromEvent(e);
      setHud({ pointerType: e.pointerType, pressure: e.pressure, x: Math.round(p[0]), y: Math.round(p[1]) });
      if (topModeRef.current === "draw" && drawToolRef.current === "eraser") {
        canvas!.style.cursor = "crosshair";
        return;
      }
      if (topModeRef.current === "draw" && drawToolRef.current === "nudge") {
        if (draggingAnchorRef.current !== null && editingStrokeIdRef.current) {
          const idx = completedRef.current.findIndex((s) => s.id === editingStrokeIdRef.current);
          if (idx !== -1) {
            const stroke = completedRef.current[idx];
            const pointIdx = anchorIndicesRef.current[draggingAnchorRef.current];
            const prevPressure = stroke.points[pointIdx][2];
            stroke.points[pointIdx] = [p[0], p[1], prevPressure];
            outlinesRef.current[idx] = outlineFor(stroke.points, effectiveSettingsFor(stroke, settingsRef.current));
            redraw();
          }
          return;
        }
        canvas!.style.cursor = editingStrokeIdRef.current ? "grab" : "pointer";
        return;
      }
      if (topModeRef.current === "draw" && TRANSFORM_TOOLS.has(drawToolRef.current)) {
        if (transformStartRef.current) {
          applyTransform(p[0], p[1]);
          redraw();
          return;
        }
        canvas!.style.cursor = "move";
        return;
      }
      if (topModeRef.current === "draw" && drawToolRef.current === "pan") {
        if (panDragStartRef.current) {
          const start = panDragStartRef.current;
          panOffsetRef.current = {
            x: start.offsetX + (e.clientX - start.clientX),
            y: start.offsetY + (e.clientY - start.clientY),
          };
          redraw();
          return;
        }
        canvas!.style.cursor = "grab";
        return;
      }
      canvas!.style.cursor = "";
      if (!drawingRef.current) return;
      if (LASSO_TOOLS.has(drawToolRef.current)) {
        lassoRef.current.push([p[0], p[1]]);
      } else {
        currentPointsRef.current.push(p);
      }
      redraw();
    }

    function onPointerUp(e: PointerEvent) {
      if (topModeRef.current === "draw" && drawToolRef.current === "nudge") {
        if (draggingAnchorRef.current !== null) {
          draggingAnchorRef.current = null;
          saveStrokes(completedRef.current);
        }
        canvas!.releasePointerCapture(e.pointerId);
        redraw();
        return;
      }
      if (topModeRef.current === "draw" && TRANSFORM_TOOLS.has(drawToolRef.current)) {
        const t = transformStartRef.current;
        if (t) {
          if (t.mode === "scale") {
            // Bake this gesture's magnitude into each scaled stroke's own
            // widthScale (geometric mean of the two axes — symmetric, so a
            // width-only or height-only stretch doesn't also thicken the
            // ink), so relative stroke thickness stays constant instead of
            // drifting as the shape grows/shrinks.
            const widthFactor = Math.sqrt(Math.abs(t.lastScaleX * t.lastScaleY));
            for (const id of t.snapshot.keys()) {
              const idx = completedRef.current.findIndex((s) => s.id === id);
              if (idx === -1) continue;
              const stroke = completedRef.current[idx];
              stroke.widthScale = (stroke.widthScale ?? 1) * widthFactor;
              outlinesRef.current[idx] = outlineFor(stroke.points, effectiveSettingsFor(stroke, settingsRef.current));
            }
          }
          transformStartRef.current = null;
          saveStrokes(completedRef.current);
        }
        canvas!.releasePointerCapture(e.pointerId);
        redraw();
        return;
      }
      if (topModeRef.current === "draw" && drawToolRef.current === "pan") {
        panDragStartRef.current = null;
        canvas!.releasePointerCapture(e.pointerId);
        redraw();
        return;
      }
      if (LASSO_TOOLS.has(drawToolRef.current)) {
        const polygon = lassoRef.current;
        const matched = completedRef.current
          .filter((s) => anyPointInPolygon(s.points.map((p) => [p[0], p[1]]) as [number, number][], polygon))
          .map((s) => s.id);
        setSelectedIds(matched);
        lassoRef.current = [];
      } else {
        if (drawingRef.current && currentPointsRef.current.length > 1) {
          pushUndoSnapshot();
          const stroke: Stroke = {
            id: `${Date.now()}-${Math.round(Math.random() * 1e6)}`,
            points: currentPointsRef.current,
            createdAt: Date.now(),
            kind: drawToolRef.current === "brush" ? "brush" : "pen",
          };
          completedRef.current = [...completedRef.current, stroke];
          outlinesRef.current = [...outlinesRef.current, outlineFor(stroke.points, settingsRef.current)];
          saveStrokes(completedRef.current);
          setStrokeCount(completedRef.current.length);
          enqueueProvenanceEvent({
            draftId: getDraftId(),
            authorId: getAuthorId(),
            clientStrokeId: stroke.id,
            context: "free",
            tool: stroke.kind === "brush" ? "brush" : "pen",
            ...summarizeStroke(stroke.points, strokeStartTimeRef.current),
          });
        }
        currentPointsRef.current = [];
      }
      drawingRef.current = false;
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
  }, []);

  // Keep the ref in sync, and re-render every stroke already on screen whenever
  // settings change — not just strokes drawn from now on.
  useEffect(() => {
    settingsRef.current = settings;
    saveSettings(settings);
    outlinesRef.current = completedRef.current.map((s) => outlineFor(s.points, effectiveSettingsFor(s, settings)));
    redrawRef.current();
  }, [settings]);

  useEffect(() => {
    drawStyleRef.current = drawStyle;
  }, [drawStyle]);

  // Keep Free mode's line raster in sync whenever its spacing changes.
  useEffect(() => {
    lineSpacingRef.current = lineSpacing;
    redrawRef.current();
  }, [lineSpacing]);

  useEffect(() => {
    topModeRef.current = topMode;
    currentPointsRef.current = [];
    lassoRef.current = [];
    setSelectedIds([]);
    exitNudgeEditing();
    redrawRef.current();
  }, [topMode]);

  useEffect(() => {
    drawToolRef.current = drawTool;
    // Nudge, Anchor, and Pen all share one "which stroke is being edited"
    // session (Pen needs it live so its insert/delete-anchor clicks — see
    // handleAnchorInsertOrDelete — have something to operate on); switching
    // to anything else exits it.
    if (drawTool !== "nudge" && drawTool !== "anchor" && drawTool !== "pen") exitNudgeEditing();
    if (drawTool !== "move" && drawTool !== "rotate" && drawTool !== "scale") transformStartRef.current = null;
    if (drawTool !== "pan") panDragStartRef.current = null;
    // Switching tools mid-gesture shouldn't leave a stale in-progress pen
    // stroke or lasso outline drawn on screen for a tool that's no longer
    // active. Selection is shared working state across SELECTION_TOOLS
    // (Assign/Select/Move/Rotate/Scale), so it's spared while switching
    // among those — only switching to a non-selection tool clears it.
    currentPointsRef.current = [];
    lassoRef.current = [];
    if (!SELECTION_TOOLS.has(drawTool)) setSelectedIds([]);
    redrawRef.current();
  }, [drawTool]);

  useEffect(() => {
    exitNudgeEditing();
    panOffsetRef.current = { x: 0, y: 0 };
    // Leaving Free strands drawTool on a value ("nudge"/"assign"/"select"/
    // "move"/"rotate"/"scale"/"pan") whose button no longer exists in the
    // UI — reset it back to the universal default so Grid/Editor don't
    // silently inherit a stale tool (see GridCell's tool coercion, which
    // would otherwise just treat it as pen with no visual indication
    // anything was off).
    setDrawTool((t) => (FREE_ONLY_TOOLS.has(t) ? "pen" : t));
    redrawRef.current();
  }, [drawStyle]);

  // Leaving the Nudge tool (or switching away from Draw/Free entirely, see
  // above) clears which stroke was being reshaped — a stale editing session
  // shouldn't reappear later just because the tool got reselected.
  function exitNudgeEditing() {
    editingStrokeIdRef.current = null;
    anchorIndicesRef.current = [];
    resampledRef.current = false;
    draggingAnchorRef.current = null;
    selectedAnchorRef.current = null;
  }

  useEffect(() => {
    selectedIdsRef.current = new Set(selectedIds);
    if (selectedIds.length === 0) {
      skewSnapshotRef.current = null;
    } else {
      const selected = completedRef.current.filter((s) => selectedIds.includes(s.id));
      const pivot = selectionPivot(selected);
      skewSnapshotRef.current = {
        pivotX: pivot.x,
        pivotY: pivot.y,
        snapshot: new Map(selected.map((s) => [s.id, s.points.map((p) => [...p] as StrokePoint)])),
      };
    }
    setSkewH(0);
    setSkewV(0);
    skewUndoPushedRef.current = false;
    redrawRef.current();
  }, [selectedIds]);

  // Mini analytics (see /anneliese): one pageview beacon per mount, plus a
  // session-duration beacon on the way out. pagehide (not just
  // visibilitychange/beforeunload) also covers mobile Safari's app-switch
  // behavior, which never fires a reliable unload event otherwise.
  useEffect(() => {
    trackPageview();
    const start = performance.now();
    function sendDuration() {
      trackDuration((performance.now() - start) / 1000);
    }
    window.addEventListener("pagehide", sendDuration);
    return () => {
      window.removeEventListener("pagehide", sendDuration);
      sendDuration();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Provenance queue: periodic flush so a long drawing session doesn't sit
  // on an ever-growing localStorage-backed queue, plus a pagehide flush so
  // closing the tab mid-session doesn't lose the tail of it (same pattern
  // as the analytics beacon above). enqueueProvenanceEvent already flushes
  // once the queue hits its own batch size — this just covers the "drew a
  // few strokes, then went idle" gap.
  useEffect(() => {
    const interval = setInterval(flushProvenanceQueue, 15000);
    window.addEventListener("pagehide", flushProvenanceQueue);
    return () => {
      clearInterval(interval);
      window.removeEventListener("pagehide", flushProvenanceQueue);
      flushProvenanceQueue();
    };
  }, []);

  useEffect(() => {
    taggedIdsRef.current = new Set(glyphs.flatMap((g) => g.strokeIds));
    gridNativeStrokeIdsRef.current = new Set(
      glyphs.filter((g) => g.cellWidth && g.cellHeight).flatMap((g) => g.strokeIds)
    );
    glyphsRef.current = glyphs;
    saveGlyphs(glyphs);
    redrawRef.current();
  }, [glyphs]);

  // Recompiled on every relevant change (not gated on any particular view
  // being open) — File > Export JSON/OTF read exportJson/exportDoc directly,
  // so they need to stay current regardless of which view the user is on.
  useEffect(() => {
    const doc = compileDocument(glyphs, completedRef.current, settings, metrics);
    setExportJson(JSON.stringify(doc, null, 2));
    setExportDoc(doc);
  }, [glyphs, settings, metrics]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        if (topModeRef.current !== "draw") return;
        e.preventDefault();
        if (e.shiftKey) redoRef.current();
        else undoRef.current();
        return;
      }

      // Per-tool shortcuts (see TOOL_DEFS) — only in Draw, and never while
      // the user is actually typing a glyph name/text (those single-letter
      // inputs can legitimately contain any of these letters).
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
      if (topModeRef.current !== "draw") return;
      const key = e.key.toLowerCase();
      const toolDef = TOOL_DEFS.find((t) => t.shortcut === key);
      if (toolDef && (!FREE_ONLY_TOOLS.has(toolDef.value) || drawStyleRef.current === "free")) {
        setDrawTool(toolDef.value);
      }
      else if (
        (e.key === "Delete" || e.key === "Backspace") &&
        drawToolRef.current === "anchor" &&
        selectedAnchorRef.current
      ) {
        e.preventDefault();
        deleteAnchorAndSplit(selectedAnchorRef.current.strokeId, selectedAnchorRef.current.rank);
      }
      else if ((e.key === "Delete" || e.key === "Backspace") && selectedIdsRef.current.size > 0) {
        e.preventDefault();
        deleteStrokes(new Set(selectedIdsRef.current));
        setSelectedIds([]);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Dismiss an open menu-bar dropdown on any click outside the menu bar
  // (tagged data-chrome-menu) — NOT a ref around the whole page, since that
  // would make every click (including ones on the canvas) count as "inside".
  useEffect(() => {
    if (!openMenu) return;
    function onPointerDownOutside(e: PointerEvent) {
      if (!(e.target as HTMLElement).closest?.("[data-chrome-menu]")) {
        setOpenMenu(null);
      }
    }
    window.addEventListener("pointerdown", onPointerDownOutside);
    return () => window.removeEventListener("pointerdown", onPointerDownOutside);
  }, [openMenu]);

  // Escape closes the Info/How-to modal — the backdrop click already
  // handles pointer dismissal, this covers keyboard users.
  useEffect(() => {
    if (!infoModal) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setInfoModal(null);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [infoModal]);

  const UNDO_HISTORY_LIMIT = 50;

  function cloneStrokesForHistory(strokes: Stroke[]): Stroke[] {
    return strokes.map((s) => ({ ...s, points: s.points.map((p) => [...p] as StrokePoint) }));
  }

  function snapshotNow(): { strokes: Stroke[]; glyphs: Glyph[] } {
    return { strokes: cloneStrokesForHistory(completedRef.current), glyphs: glyphsRef.current.map((g) => ({ ...g })) };
  }

  // Call this right before ANY mutation to completedRef/glyphs that should
  // be undoable — a new stroke, a deletion, a Nudge/Move/Rotate/Scale
  // commit. Captures the state as it was the instant before, so handleUndo
  // just needs to jump back to whatever's on top of this stack.
  function pushUndoSnapshot() {
    undoStackRef.current = [...undoStackRef.current.slice(-(UNDO_HISTORY_LIMIT - 1)), snapshotNow()];
    redoStackRef.current = [];
    setUndoCount(undoStackRef.current.length);
    setRedoCount(0);
  }

  function applySnapshot(snap: { strokes: Stroke[]; glyphs: Glyph[] }) {
    completedRef.current = snap.strokes;
    outlinesRef.current = snap.strokes.map((s) => outlineFor(s.points, effectiveSettingsFor(s, settingsRef.current)));
    saveStrokes(completedRef.current);
    setStrokeCount(completedRef.current.length);
    setGlyphs(snap.glyphs);
    // Any in-progress Nudge/transform session was editing state that no
    // longer exists after the jump — drop it rather than let it silently
    // keep mutating a stroke id from a different point in history.
    exitNudgeEditing();
    transformStartRef.current = null;
    setSelectedIds([]);
    redrawRef.current();
  }

  function handleUndo() {
    if (undoStackRef.current.length === 0) return;
    const current = snapshotNow();
    const prev = undoStackRef.current[undoStackRef.current.length - 1];
    undoStackRef.current = undoStackRef.current.slice(0, -1);
    redoStackRef.current = [...redoStackRef.current, current];
    setUndoCount(undoStackRef.current.length);
    setRedoCount(redoStackRef.current.length);
    applySnapshot(prev);
  }
  undoRef.current = handleUndo;

  function handleRedo() {
    if (redoStackRef.current.length === 0) return;
    const current = snapshotNow();
    const next = redoStackRef.current[redoStackRef.current.length - 1];
    redoStackRef.current = redoStackRef.current.slice(0, -1);
    undoStackRef.current = [...undoStackRef.current, current];
    setUndoCount(undoStackRef.current.length);
    setRedoCount(redoStackRef.current.length);
    applySnapshot(next);
  }
  redoRef.current = handleRedo;

  function handleClear() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    if (completedRef.current.length > 0 || glyphsRef.current.length > 0) pushUndoSnapshot();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    completedRef.current = [];
    outlinesRef.current = [];
    clearStrokes();
    setStrokeCount(0);
    setGlyphs([]);
    setSelectedIds([]);
  }

  function updateSetting<K extends keyof StrokeSettings>(key: K, value: StrokeSettings[K]) {
    setSettings((s) => ({ ...s, [key]: value }));
  }

  // Shears the selection around its bbox center, always recomputed from the
  // ONE pre-skew snapshot captured when the selection was made (see the
  // [selectedIds] effect above) — a proper combined shear matrix using each
  // point's ORIGINAL offset from the pivot for both axes, so horizontal and
  // vertical skew combine cleanly regardless of slider order, and repeated
  // small ticks never compound/drift.
  function applySkew(hDeg: number, vDeg: number) {
    const snap = skewSnapshotRef.current;
    if (!snap) return;
    const kH = Math.tan((hDeg * Math.PI) / 180);
    const kV = Math.tan((vDeg * Math.PI) / 180);
    for (const [id, points] of snap.snapshot) {
      const idx = completedRef.current.findIndex((s) => s.id === id);
      if (idx === -1) continue;
      const stroke = completedRef.current[idx];
      stroke.points = points.map(([px, py, pressure]) => {
        const dx = px - snap.pivotX;
        const dy = py - snap.pivotY;
        return [snap.pivotX + dx + kH * dy, snap.pivotY + dy + kV * dx, pressure] as StrokePoint;
      });
      outlinesRef.current[idx] = outlineFor(stroke.points, effectiveSettingsFor(stroke, settingsRef.current));
    }
    saveStrokes(completedRef.current);
    redrawRef.current();
  }

  function updateSkewH(hDeg: number) {
    if (!skewUndoPushedRef.current) {
      pushUndoSnapshot();
      skewUndoPushedRef.current = true;
    }
    setSkewH(hDeg);
    applySkew(hDeg, skewV);
  }

  function updateSkewV(vDeg: number) {
    if (!skewUndoPushedRef.current) {
      pushUndoSnapshot();
      skewUndoPushedRef.current = true;
    }
    setSkewV(vDeg);
    applySkew(skewH, vDeg);
  }

  function handleAssign() {
    const name = nameInput.trim();
    if (!name || selectedIds.length === 0) return;
    const glyph: Glyph = {
      id: `${Date.now()}-${Math.round(Math.random() * 1e6)}`,
      name,
      kind: kindInput,
      strokeIds: selectedIds,
      createdAt: Date.now(),
      ...(kindInput === "base" ? { unicode: unicodeFor(name) } : {}),
      ...(kindInput === "ligature"
        ? { components: componentsInput.split(/[\s,]+/).map((c) => c.trim()).filter(Boolean) }
        : {}),
      ...(kindInput === "alternate" ? { alternateOf: alternateOfInput.trim() || undefined } : {}),
    };
    setGlyphs((gs) => [...gs, glyph]);
    setSelectedIds([]);
    setNameInput("");
    setComponentsInput("");
    setAlternateOfInput("");
  }

  function handleAssignKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      handleAssign();
    }
  }

  // Grid's own version of handleAssign — instead of tagging an existing
  // lasso selection, this just adds an empty cell to draw into (Grid fuses
  // capture+tagging on first stroke, so there's nothing to select yet).
  // Shares nameInput/kindInput/componentsInput/alternateOfInput with Free's
  // Assign panel since the two forms are never visible at the same time.
  function handleAddGridSlot() {
    const name = nameInput.trim();
    if (!name) return;
    addGridSlot({
      name,
      kind: kindInput,
      ...(kindInput === "ligature"
        ? { components: componentsInput.split(/[\s,]+/).map((c) => c.trim()).filter(Boolean) }
        : {}),
      ...(kindInput === "alternate" ? { alternateOf: alternateOfInput.trim() || undefined } : {}),
    });
    setNameInput("");
    setComponentsInput("");
    setAlternateOfInput("");
  }

  function handleUntag(id: string) {
    setGlyphs((gs) => gs.filter((g) => g.id !== id));
  }

  // Shared by the Eraser tool's single-stroke click-to-delete, the
  // Delete/Backspace shortcut's whole-selection removal, and GridCell's own
  // eraser/Delete-key handling: either way it's "remove these ids from
  // completedRef/outlinesRef and untie them from any glyph." One call here
  // is always exactly one undo step, however many ids it covers — that's
  // why GridCell's Delete-key handler passes its whole selection in one
  // Set rather than looping single-id calls.
  function deleteStrokes(idsToDelete: Set<string>) {
    if (idsToDelete.size === 0) return;
    pushUndoSnapshot();
    const survivors = completedRef.current
      .map((stroke, i) => ({ stroke, outline: outlinesRef.current[i] }))
      .filter(({ stroke }) => !idsToDelete.has(stroke.id));
    completedRef.current = survivors.map((s) => s.stroke);
    outlinesRef.current = survivors.map((s) => s.outline);
    saveStrokes(completedRef.current);
    setStrokeCount(completedRef.current.length);
    // Strokes that got deleted no longer belong to any glyph; a glyph left
    // with zero strokes doesn't mean anything, so drop it too.
    setGlyphs((gs) =>
      gs
        .map((g) => ({ ...g, strokeIds: g.strokeIds.filter((id) => !idsToDelete.has(id)) }))
        .filter((g) => g.strokeIds.length > 0)
    );
    setSelectedIds((ids) => ids.filter((id) => !idsToDelete.has(id)));
  }

  // Eraser tool: click a completed stroke in Draw mode to delete it
  // immediately, no lasso/select step needed. Topmost (last-drawn) stroke
  // wins when strokes overlap — same convention as GridCell's select mode.
  function eraseAt(x: number, y: number): boolean {
    for (let i = completedRef.current.length - 1; i >= 0; i--) {
      if (pointInPolygon([x, y], outlinesRef.current[i])) {
        deleteStrokes(new Set([completedRef.current[i].id]));
        return true;
      }
    }
    return false;
  }

  // Is (x, y) within grabbing distance of one of the currently-editing
  // stroke's anchor handles? Returns the anchor's rank (its position within
  // `indices`, not the raw point index) so the caller has a stable handle
  // that survives the lazy resample below (resampling preserves order, so
  // rank i always means "the same anchor" before and after).
  function anchorNear(x: number, y: number, points: StrokePoint[], indices: number[]): number | null {
    for (let rank = indices.length - 1; rank >= 0; rank--) {
      const [px, py] = points[indices[rank]];
      if (Math.hypot(x - px, y - py) <= ANCHOR_HIT_PX) return rank;
    }
    return null;
  }

  // Nudge tool click: if already editing a stroke, first check for an
  // anchor grab (and start dragging it — lazily resampling the stroke down
  // to just its anchors on the very first drag of this session, see the
  // comment inline). Otherwise, clicking any stroke (including the one
  // already being edited) starts/switches the editing session onto it;
  // clicking empty space exits editing. Topmost (last-drawn) stroke wins,
  // same convention as the Eraser tool and GridCell's select mode.
  function handleNudgePointerDown(x: number, y: number) {
    if (editingStrokeIdRef.current) {
      const idx = completedRef.current.findIndex((s) => s.id === editingStrokeIdRef.current);
      if (idx !== -1) {
        const stroke = completedRef.current[idx];
        const rank = anchorNear(x, y, stroke.points, anchorIndicesRef.current);
        if (rank !== null) {
          // An actual anchor grab is a real, undoable mutation — captured
          // once here, before the (possibly first-ever) resample, so Undo
          // restores the original dense points, not the resampled shape.
          pushUndoSnapshot();
          if (!resampledRef.current) {
            // Non-destructive up to this exact moment: a stroke the user
            // merely selects (or drags near but never actually grabs) stays
            // byte-for-byte untouched. Only an actual anchor grab collapses
            // the dense raw samples down to just the retained anchors, so
            // moving one afterward reshapes the segment the way a real
            // vector-tool edit would, instead of nudging one sample among
            // dozens that immediately pull the curve back.
            stroke.points = anchorIndicesRef.current.map((i) => stroke.points[i]);
            anchorIndicesRef.current = stroke.points.map((_, i) => i);
            resampledRef.current = true;
            outlinesRef.current[idx] = outlineFor(stroke.points, effectiveSettingsFor(stroke, settingsRef.current));
          }
          draggingAnchorRef.current = rank;
          return;
        }
      }
    }

    for (let i = completedRef.current.length - 1; i >= 0; i--) {
      const stroke = completedRef.current[i];
      // A brush stroke's points trace its own edge, not a true centerline —
      // editing them as if they were one wouldn't reshape the visible ink
      // sensibly. Skip silently, same as clicking empty space would.
      if ((stroke.kind ?? "pen") === "brush") continue;
      if (pointInPolygon([x, y], outlinesRef.current[i])) {
        editingStrokeIdRef.current = stroke.id;
        anchorIndicesRef.current = simplifyStrokeIndices(stroke.points.map((p) => [p[0], p[1]]));
        resampledRef.current = false;
        return;
      }
    }
    exitNudgeEditing();
  }

  // Anchor tool click: if a stroke is already being edited (editingStrokeIdRef
  // set — via a prior click here, or via Nudge, since the two tools share one
  // editing session, see the [drawTool] effect above), clicking one of its
  // anchors SELECTS it — persisted in selectedAnchorRef, unlike Nudge's
  // drag-only grab — rather than starting a drag. Clicking the stroke
  // elsewhere (no anchor hit) keeps editing it but deselects any anchor.
  // Clicking a different stroke switches the editing session onto it,
  // exactly Nudge's own fallback; clicking empty space exits. Topmost
  // stroke wins, same convention as Nudge/Eraser.
  function handleAnchorToolPointerDown(x: number, y: number) {
    if (editingStrokeIdRef.current) {
      const idx = completedRef.current.findIndex((s) => s.id === editingStrokeIdRef.current);
      if (idx !== -1) {
        const stroke = completedRef.current[idx];
        const rank = anchorNear(x, y, stroke.points, anchorIndicesRef.current);
        if (rank !== null) {
          selectedAnchorRef.current = { strokeId: stroke.id, rank };
          return;
        }
      }
    }
    for (let i = completedRef.current.length - 1; i >= 0; i--) {
      const stroke = completedRef.current[i];
      if ((stroke.kind ?? "pen") === "brush") continue;
      if (pointInPolygon([x, y], outlinesRef.current[i])) {
        editingStrokeIdRef.current = stroke.id;
        anchorIndicesRef.current = simplifyStrokeIndices(stroke.points.map((p) => [p[0], p[1]]));
        resampledRef.current = false;
        selectedAnchorRef.current = null;
        return;
      }
    }
    exitNudgeEditing();
  }

  // Pen-tool insert-between-anchors hit test: projects (x, y) onto each
  // segment between consecutive anchors, clamped to the segment itself (not
  // simplify.ts's perpendicularDistance, which projects onto the INFINITE
  // line for a different purpose — simplification, not hit-testing a finite
  // segment). Returns the LEFT rank of the segment the click falls near
  // ("insert between rank and rank+1"), not a raw point index — see
  // insertAnchor for why rank is what survives the lazy resample below.
  function findInsertionRank(x: number, y: number, points: StrokePoint[], indices: number[]): number | null {
    for (let rank = 0; rank < indices.length - 1; rank++) {
      const [x1, y1] = points[indices[rank]];
      const [x2, y2] = points[indices[rank + 1]];
      const dx = x2 - x1;
      const dy = y2 - y1;
      const lenSq = dx * dx + dy * dy;
      if (lenSq === 0) continue;
      const t = ((x - x1) * dx + (y - y1) * dy) / lenSq;
      if (t < 0 || t > 1) continue;
      const projX = x1 + t * dx;
      const projY = y1 + t * dy;
      if (Math.hypot(x - projX, y - projY) <= ANCHOR_HIT_PX) return rank;
    }
    return null;
  }

  // Inserts a new anchor right after `afterRank`. Forces the same lazy
  // resample-to-anchors-only collapse Nudge's first drag does (if it hasn't
  // already happened this editing session) BEFORE converting the rank to a
  // raw point index — after that resample, anchorIndicesRef is always the
  // identity 0..n-1 over stroke.points, so rank and raw index coincide.
  // Doing it in this order (rank in, resample, then rank->index) is what
  // keeps this correct whether or not a resample was already pending;
  // resolving to a raw index first and resampling after would silently
  // insert at the wrong position once the array shrinks out from under it.
  function insertAnchor(strokeId: string, afterRank: number, x: number, y: number) {
    const idx = completedRef.current.findIndex((s) => s.id === strokeId);
    if (idx === -1) return;
    pushUndoSnapshot();
    const stroke = completedRef.current[idx];
    if (!resampledRef.current) {
      stroke.points = anchorIndicesRef.current.map((i) => stroke.points[i]);
      anchorIndicesRef.current = stroke.points.map((_, i) => i);
      resampledRef.current = true;
    }
    const pointIndex = afterRank + 1;
    const before = stroke.points[pointIndex - 1];
    const after = stroke.points[pointIndex];
    const pressure = before && after ? (before[2] + after[2]) / 2 : (before ?? after)?.[2] ?? 0.5;
    stroke.points = [
      ...stroke.points.slice(0, pointIndex),
      [x, y, pressure] as StrokePoint,
      ...stroke.points.slice(pointIndex),
    ];
    anchorIndicesRef.current = anchorIndicesRef.current
      .map((i) => (i >= pointIndex ? i + 1 : i))
      .concat(pointIndex)
      .sort((a, b) => a - b);
    outlinesRef.current[idx] = outlineFor(stroke.points, effectiveSettingsFor(stroke, settingsRef.current));
    saveStrokes(completedRef.current);
    redrawRef.current();
  }

  // Deletes the anchor at `rank` and splits the stroke into two at that
  // position (the deleted point itself is dropped, not bridged). Same
  // resample-first-if-needed + rank->index conversion as insertAnchor.
  // Deleting an endpoint (rank 0 or the last) just shrinks the stroke by one
  // point instead of splitting — one side would be empty anyway. A stroke
  // collapsing below 2 points afterward is dropped entirely, matching how
  // deleteStrokes already treats a glyph left with 0 strokes. This is a
  // structural edit (changes stroke/glyph count), a strictly more
  // destructive class than anchor-dragging or insertion — hence its own
  // pushUndoSnapshot rather than piggybacking on one of those.
  function deleteAnchorAndSplit(strokeId: string, rank: number) {
    const idx = completedRef.current.findIndex((s) => s.id === strokeId);
    if (idx === -1) return;
    pushUndoSnapshot();
    const stroke = completedRef.current[idx];
    if (!resampledRef.current) {
      stroke.points = anchorIndicesRef.current.map((i) => stroke.points[i]);
      anchorIndicesRef.current = stroke.points.map((_, i) => i);
      resampledRef.current = true;
    }
    const pointIndex = rank;
    const before = stroke.points.slice(0, pointIndex);
    const after = stroke.points.slice(pointIndex + 1);

    const newStrokes: Stroke[] = [];
    if (pointIndex === 0 || pointIndex === stroke.points.length - 1) {
      const shrunk = pointIndex === 0 ? after : before;
      if (shrunk.length >= 2) newStrokes.push({ ...stroke, points: shrunk });
    } else {
      if (before.length >= 2) {
        newStrokes.push({ id: `${Date.now()}-${Math.round(Math.random() * 1e6)}-a`, points: before, createdAt: stroke.createdAt });
      }
      if (after.length >= 2) {
        newStrokes.push({ id: `${Date.now()}-${Math.round(Math.random() * 1e6)}-b`, points: after, createdAt: stroke.createdAt });
      }
    }

    completedRef.current = completedRef.current.flatMap((s, i) => (i === idx ? newStrokes : [s]));
    outlinesRef.current = completedRef.current.map((s) => outlineFor(s.points, effectiveSettingsFor(s, settingsRef.current)));
    saveStrokes(completedRef.current);
    setStrokeCount(completedRef.current.length);

    // Mirrors deleteStrokes's own glyph-bookkeeping pattern: the one deleted
    // stroke id is replaced by however many new ids it split into (0, 1, or
    // 2), and a glyph left with no strokes is dropped.
    setGlyphs((gs) =>
      gs
        .map((g) =>
          g.strokeIds.includes(strokeId)
            ? { ...g, strokeIds: g.strokeIds.flatMap((id) => (id === strokeId ? newStrokes.map((s) => s.id) : [id])) }
            : g
        )
        .filter((g) => g.strokeIds.length > 0)
    );

    exitNudgeEditing();
  }

  // Move/Rotate/Scale click: the pointerdown must land on a stroke that's
  // already part of selectedIds (populated by Select/Assign's lasso first) —
  // clicking an unselected stroke or empty space is a no-op, same "you pick
  // your selection separately, then act on it" split as Figma/Illustrator.
  // On a hit, the anchor and a frozen snapshot of every selected stroke's
  // points are captured once; every subsequent pointermove recomputes from
  // that snapshot rather than the live (already-mutated) points, same shape
  // as Nudge's per-anchor drag above, just applied to a whole selection at
  // once. For Scale, the anchor is the selection's bbox bottom-left by
  // default, or its center if Alt is held (Alt preserves what used to be the
  // only behavior); Shift locks the gesture to uniform scaling. Move/Rotate
  // ignore both modifiers — only Scale's anchor/uniformity changes here.
  function handleTransformPointerDown(
    x: number,
    y: number,
    mode: "move" | "rotate" | "scale",
    altKey: boolean,
    shiftKey: boolean
  ) {
    let hit = false;
    for (let i = completedRef.current.length - 1; i >= 0; i--) {
      if (selectedIdsRef.current.has(completedRef.current[i].id) && pointInPolygon([x, y], outlinesRef.current[i])) {
        hit = true;
        break;
      }
    }
    if (!hit) return;
    pushUndoSnapshot();

    const selected = completedRef.current.filter((s) => selectedIdsRef.current.has(s.id));
    const anchor = mode === "scale" && !altKey ? selectionBottomLeft(selected) : selectionPivot(selected);
    const snapshot = new Map(selected.map((s) => [s.id, s.points.map((p) => [...p] as StrokePoint)]));
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
      currentX: x,
      currentY: y,
    };
  }

  // Applies the live pointer position against the frozen snapshot/anchor
  // captured above, for whichever of Move/Rotate/Scale is active. Mutates
  // completedRef's strokes + outlinesRef in place (mirroring every other
  // in-place stroke edit in this file) and leaves saving for pointerup.
  function applyTransform(x: number, y: number) {
    const t = transformStartRef.current;
    if (!t) return;
    t.currentX = x;
    t.currentY = y;
    const dx = x - t.startX;
    const dy = y - t.startY;
    const angle = Math.atan2(y - t.pivotY, x - t.pivotX) - t.startAngle;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);

    // Non-uniform scale: independent x/y ratios from the anchor, signed so a
    // corner drag can pull past the anchor (mirroring the shape), same as a
    // vector editor's corner handle. Shift (t.uniform) collapses both back
    // to the single hypot-ratio factor Scale always used before this change.
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
      const idx = completedRef.current.findIndex((s) => s.id === id);
      if (idx === -1) continue;
      const stroke = completedRef.current[idx];
      stroke.points = points.map(([px, py, pressure]) => {
        if (t.mode === "move") return [px + dx, py + dy, pressure] as StrokePoint;
        if (t.mode === "rotate") {
          const ox = px - t.pivotX;
          const oy = py - t.pivotY;
          return [t.pivotX + ox * cos - oy * sin, t.pivotY + ox * sin + oy * cos, pressure] as StrokePoint;
        }
        // scale
        return [t.pivotX + (px - t.pivotX) * scaleX, t.pivotY + (py - t.pivotY) * scaleY, pressure] as StrokePoint;
      });
      outlinesRef.current[idx] = outlineFor(stroke.points, effectiveSettingsFor(stroke, settingsRef.current));
    }
  }

  function handleGridStroke(
    slot: GridSlot,
    stroke: Stroke,
    currentCellWidth: number,
    currentCellHeight: number,
    durationMs: number
  ) {
    pushUndoSnapshot();
    // Convert to the glyph's existing anchor space (if it already has one)
    // before storing, so this stroke stays geometrically consistent with
    // whatever other strokes it already has — even if Cell size/width has
    // changed since those were drawn. See fromAnchorSpace/toAnchorSpace.
    const existingGlyph = glyphsRef.current.find((g) => g.kind === slot.kind && g.name === slot.name);
    const anchoredPoints = toAnchorSpace(
      stroke.points,
      existingGlyph?.cellWidth,
      existingGlyph?.cellHeight,
      currentCellWidth,
      currentCellHeight,
      keepProportions
    );
    const anchoredStroke = anchoredPoints === stroke.points ? stroke : { ...stroke, points: anchoredPoints };
    completedRef.current = [...completedRef.current, anchoredStroke];
    outlinesRef.current = [...outlinesRef.current, outlineFor(anchoredStroke.points, settingsRef.current)];
    saveStrokes(completedRef.current);
    setStrokeCount(completedRef.current.length);
    enqueueProvenanceEvent({
      draftId: getDraftId(),
      authorId: getAuthorId(),
      clientStrokeId: anchoredStroke.id,
      context: "grid",
      tool: anchoredStroke.kind === "brush" ? "brush" : "pen",
      // durationMs was measured directly by GridCell (only it knows its own
      // pointerdown time) — reproduced here via summarizeStroke's own
      // Date.now()-startedAt math rather than adding a second code path.
      ...summarizeStroke(anchoredStroke.points, Date.now() - durationMs),
    });

    // Grid drawing fuses capture + tagging: the cell you draw into IS the
    // glyph, no separate lasso-select step. First stroke creates the glyph,
    // later strokes into the same cell just add to it.
    setGlyphs((gs) => {
      const existing = gs.find((g) => g.kind === slot.kind && g.name === slot.name);
      if (existing) {
        return gs.map((g) => (g.id === existing.id ? { ...g, strokeIds: [...g.strokeIds, anchoredStroke.id] } : g));
      }
      const glyph: Glyph = {
        id: `${Date.now()}-${Math.round(Math.random() * 1e6)}`,
        name: slot.name,
        kind: slot.kind,
        strokeIds: [anchoredStroke.id],
        createdAt: Date.now(),
        leftBearing: DEFAULT_LEFT_BEARING,
        rightBearing: DEFAULT_RIGHT_BEARING,
        cellWidth: currentCellWidth,
        cellHeight: currentCellHeight,
        ...(slot.kind === "base" ? { unicode: unicodeFor(slot.name) } : {}),
        ...(slot.kind === "ligature" ? { components: slot.components ?? [] } : {}),
        ...(slot.kind === "alternate" ? { alternateOf: slot.alternateOf } : {}),
      };
      return [...gs, glyph];
    });
  }

  // Commits a GridCell-side Nudge/Move/Rotate/Scale edit back into the
  // shared stroke store. Mirrors the direct in-place mutation style Free's
  // own Nudge/transform tools already use (patch by index, then save) —
  // just driven by ids reported up from the cell instead of a local ref.
  function handleGridStrokesChange(
    slot: GridSlot,
    updates: { id: string; points: StrokePoint[]; widthScale?: number }[],
    currentCellWidth: number,
    currentCellHeight: number
  ) {
    if (updates.length === 0) return;
    pushUndoSnapshot();
    const glyph = glyphsRef.current.find((g) => g.kind === slot.kind && g.name === slot.name);
    for (const { id, points: rawPoints, widthScale } of updates) {
      const idx = completedRef.current.findIndex((s) => s.id === id);
      if (idx === -1) continue;
      // Same anchor conversion as handleGridStroke — GridCell reports these
      // points in current-cell pixel space, but they need to land back in
      // the glyph's own fixed anchor space so fromAnchorSpace can keep
      // expanding the whole glyph consistently on every future render.
      const points = toAnchorSpace(
        rawPoints,
        glyph?.cellWidth,
        glyph?.cellHeight,
        currentCellWidth,
        currentCellHeight,
        keepProportions
      );
      completedRef.current[idx] = { ...completedRef.current[idx], points, ...(widthScale !== undefined ? { widthScale } : {}) };
      outlinesRef.current[idx] = outlineFor(points, effectiveSettingsFor(completedRef.current[idx], settingsRef.current));
    }
    saveStrokes(completedRef.current);

    // A GridCell-side edit mutates whatever's currently displayed there —
    // for a Free-tagged (bbox-fallback) glyph that's the FITTED points, not
    // its original Free-canvas coordinates. Writing those back as the
    // glyph's real points while it's still flagged as "needs fitting" would
    // re-fit an already-fitted shape and drift further on every edit.
    // Promoting it to Grid-native (same cellWidth/cellHeight a fresh
    // Grid-drawn stroke gets) the moment it's edited here fixes its
    // anchor space for good — later renders/edits then rescale off of it.
    setGlyphs((gs) =>
      gs.map((g) =>
        g.kind === slot.kind && g.name === slot.name && !(g.cellWidth && g.cellHeight)
          ? { ...g, cellWidth: currentCellWidth, cellHeight: currentCellHeight }
          : g
      )
    );
  }

  function handleBearingsChange(slot: GridSlot, left: number, right: number) {
    setGlyphs((gs) =>
      gs.map((g) => (g.kind === slot.kind && g.name === slot.name ? { ...g, leftBearing: left, rightBearing: right } : g))
    );
  }

  function handleDownloadJson() {
    trackExport("json");
    const blob = new Blob([exportJson], { type: "application/json" });
    saveFile(blob, {
      suggestedName: "fontane-document.json",
      mimeType: "application/json",
      extension: "json",
      description: "Fontane document",
    });
  }

  function handleExportOtf() {
    if (!exportDoc) return;
    trackExport("otf");
    downloadFont(exportDoc, "fontane.otf");
  }

  function handleExportSkeleton() {
    trackExport("skeleton-svg");
    downloadSkeletonSvg(glyphs, completedRef.current);
  }

  function handleDownloadFff() {
    trackExport("fff");
    downloadProjectFile(glyphs, completedRef.current, metrics, settings, "untitled.fff");
  }

  function handleImportFffClick() {
    fffInputRef.current?.click();
  }

  function handleImportFffChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file next time
    if (!file) return;
    file.text().then((text) => {
      try {
        applyProjectFile(parseProjectFile(text));
        window.location.reload();
      } catch (err) {
        alert(err instanceof Error ? err.message : "Could not read this file.");
      }
    });
  }

  // "Yes" saves via the existing Export FFF flow first, "No" skips straight
  // to clearing. Same reset as handleClear, plus metrics/settings back to
  // their defaults — Clear all only ever touched glyphs/strokes since it's
  // scoped to canvas content, but New File means a genuinely blank project.
  function handleNewFile(shouldSave: boolean) {
    if (shouldSave) handleDownloadFff();
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    completedRef.current = [];
    outlinesRef.current = [];
    clearStrokes();
    setStrokeCount(0);
    setGlyphs([]);
    setSelectedIds([]);
    setMetrics(DEFAULT_METRICS);
    saveMetrics(DEFAULT_METRICS);
    setSettings(DEFAULT_SETTINGS);
    setConfirmNewFile(false);
    // A fresh project needs a fresh provenance trail — otherwise whatever
    // accrued for the strokes just cleared could be reused to publish
    // unrelated later work.
    rollDraftId();
  }

  function closeMarketplaceModal() {
    setMarketplaceModal(null);
    setPublishName("");
    setPublishAuthorName("");
    setPublishAuthorUrl("");
    setSlugCheck(null);
    setSlugChecking(false);
    setLicenseAccepted(false);
    setPublishing(false);
    setPublishError(null);
    setPublishedSlug(null);
    setShareQuery("");
    setShareResults([]);
    setShareSearching(false);
    setShareCopyState("idle");
    setShareCopiedSlug(null);
  }

  async function handlePublish() {
    const trimmed = publishName.trim();
    if (!exportDoc || glyphs.length === 0 || !slugCheck?.available || !licenseAccepted) return;
    setPublishing(true);
    setPublishError(null);
    try {
      // Best-effort: make sure whatever's still queued lands before the
      // server checks for it. If this fails (offline, flaky network), the
      // publish attempt still proceeds — the server just sees a sparser
      // trail and the gate is stricter accordingly, not a hard client-side
      // block.
      await flushProvenanceQueueAndWait();
      const font = buildFont(exportDoc, trimmed);
      const blob = new Blob([font.toArrayBuffer()], { type: "font/otf" });
      const form = new FormData();
      form.append("font", blob, "font.otf");
      form.append("name", trimmed);
      form.append("glyphCount", String(glyphs.length));
      form.append("licenseAccepted", "true");
      form.append("draftId", getDraftId());
      form.append("authorId", getAuthorId());
      if (publishAuthorName.trim()) form.append("authorName", publishAuthorName.trim());
      if (publishAuthorUrl.trim()) form.append("authorUrl", publishAuthorUrl.trim());
      const res = await fetch("/api/fonts/publish", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) {
        setPublishError(typeof data.error === "string" ? data.error : "Publish failed.");
        return;
      }
      trackExport("marketplace-publish");
      setPublishedSlug(data.slug);
    } catch {
      setPublishError("Network error — please try again.");
    } finally {
      setPublishing(false);
    }
  }

  function handleShareCopy(slug: string) {
    const url = `${window.location.origin}/marketplace/${slug}`;
    navigator.clipboard
      .writeText(url)
      .then(() => {
        setShareCopyState("copied");
        setShareCopiedSlug(slug);
      })
      .catch(() => {
        setShareCopyState("failed");
        setShareCopiedSlug(slug);
      });
    setTimeout(() => setShareCopyState("idle"), 1500);
  }

  function selectView(v: ViewDef) {
    setTopMode(v.topMode);
    if (v.drawStyle) setDrawStyle(v.drawStyle);
    setOpenMenu(null);
  }

  const visibleTools = TOOL_DEFS.filter((t) => (FREE_ONLY_TOOLS.has(t.value) ? drawStyle === "free" : true));

  return (
    <div className={styles.page}>
      <BetaBadge />

      <div className={styles.menuBar} data-chrome-menu>
        <div
          className={styles.menuItem}
          onMouseEnter={() => openMenuOnHover("glypher")}
          onMouseLeave={scheduleMenuHoverClose}
        >
          <button
            type="button"
            className={`${styles.menuTrigger} ${styles.appName}`}
            aria-haspopup="menu"
            aria-expanded={openMenu === "glypher"}
            onClick={() => setOpenMenu((m) => (m === "glypher" ? null : "glypher"))}
          >
            Fontane.Studio
          </button>
          {openMenu === "glypher" && (
            <div className={styles.dropdown} role="menu">
              <button
                type="button"
                role="menuitem"
                className={styles.dropdownItem}
                onClick={() => { setInfoModal("info"); setOpenMenu(null); }}
              >
                Info
              </button>
              <button
                type="button"
                role="menuitem"
                className={styles.dropdownItem}
                onClick={() => { setInfoModal("howto"); setOpenMenu(null); }}
              >
                How to
              </button>
              <a
                href="https://cnsl.aisu.studio/submit/fontane-cb43f90b"
                target="_blank"
                rel="noopener noreferrer"
                role="menuitem"
                className={styles.dropdownItem}
                onClick={() => setOpenMenu(null)}
              >
                See &amp; Suggest Features
              </a>
            </div>
          )}
        </div>

        <div
          className={styles.menuItem}
          onMouseEnter={() => openMenuOnHover("file")}
          onMouseLeave={scheduleMenuHoverClose}
        >
          <button
            type="button"
            className={styles.menuTrigger}
            aria-haspopup="menu"
            aria-expanded={openMenu === "file"}
            onClick={() => setOpenMenu((m) => (m === "file" ? null : "file"))}
          >
            File
          </button>
          {openMenu === "file" && (
            <div className={styles.dropdown} role="menu">
              <button type="button" role="menuitem" className={styles.dropdownItem} onClick={() => { setConfirmNewFile(true); setOpenMenu(null); }}>
                New File
              </button>
              <button type="button" role="menuitem" className={styles.dropdownItem} onClick={() => { handleImportFffClick(); setOpenMenu(null); }}>
                Import FFF
              </button>
              <button type="button" role="menuitem" className={styles.dropdownItem} onClick={() => { handleDownloadFff(); setOpenMenu(null); }}>
                Export FFF
              </button>
              <button type="button" role="menuitem" className={styles.dropdownItem} onClick={() => { handleDownloadJson(); setOpenMenu(null); }}>
                Export JSON
              </button>
              <button
                type="button"
                role="menuitem"
                className={styles.dropdownItem}
                disabled={glyphs.length === 0}
                onClick={() => { handleExportOtf(); setOpenMenu(null); }}
              >
                Export OTF
              </button>
              <button
                type="button"
                role="menuitem"
                className={styles.dropdownItem}
                disabled={glyphs.length === 0}
                onClick={() => { handleExportSkeleton(); setOpenMenu(null); }}
              >
                Export Skeleton SVG
              </button>
            </div>
          )}
        </div>

        <div
          className={styles.menuItem}
          onMouseEnter={() => openMenuOnHover("edit")}
          onMouseLeave={scheduleMenuHoverClose}
        >
          <button
            type="button"
            className={styles.menuTrigger}
            aria-haspopup="menu"
            aria-expanded={openMenu === "edit"}
            onClick={() => setOpenMenu((m) => (m === "edit" ? null : "edit"))}
          >
            Edit
          </button>
          {openMenu === "edit" && (
            <div className={styles.dropdown} role="menu">
              <button
                type="button"
                role="menuitem"
                className={styles.dropdownItem}
                disabled={topMode !== "draw" || undoCount === 0}
                onClick={() => { handleUndo(); setOpenMenu(null); }}
              >
                Undo
              </button>
              <button
                type="button"
                role="menuitem"
                className={styles.dropdownItem}
                disabled={topMode !== "draw" || redoCount === 0}
                onClick={() => { handleRedo(); setOpenMenu(null); }}
              >
                Redo
              </button>
              <button type="button" role="menuitem" className={styles.dropdownItem} onClick={() => { handleClear(); setOpenMenu(null); }}>
                Clear Artboard
              </button>
            </div>
          )}
        </div>

        <div
          className={styles.menuItem}
          onMouseEnter={() => openMenuOnHover("view")}
          onMouseLeave={scheduleMenuHoverClose}
        >
          <button
            type="button"
            className={styles.menuTrigger}
            aria-haspopup="menu"
            aria-expanded={openMenu === "view"}
            onClick={() => setOpenMenu((m) => (m === "view" ? null : "view"))}
          >
            View
          </button>
          {openMenu === "view" && (
            <div className={styles.dropdown} role="menu">
              {VIEW_DEFS.map((v) => {
                const active = topMode === v.topMode && (!v.drawStyle || drawStyle === v.drawStyle);
                return (
                  <button
                    key={v.key}
                    type="button"
                    role="menuitem"
                    className={`${styles.dropdownItem} ${active ? styles.dropdownItemActive : ""}`}
                    onClick={() => selectView(v)}
                  >
                    {v.label}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div
          className={styles.menuItem}
          onMouseEnter={() => openMenuOnHover("tools")}
          onMouseLeave={scheduleMenuHoverClose}
        >
          <button
            type="button"
            className={styles.menuTrigger}
            aria-haspopup="menu"
            aria-expanded={openMenu === "tools"}
            onClick={() => setOpenMenu((m) => (m === "tools" ? null : "tools"))}
          >
            Tools
          </button>
          {openMenu === "tools" && (
            <div className={styles.dropdown} role="menu">
              {visibleTools.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  role="menuitem"
                  className={`${styles.dropdownItem} ${drawTool === t.value ? styles.dropdownItemActive : ""}`}
                  onClick={() => { setDrawTool(t.value); setOpenMenu(null); }}
                >
                  {t.label} ({t.shortcut})
                </button>
              ))}
            </div>
          )}
        </div>

        <div
          className={styles.menuItem}
          onMouseEnter={() => openMenuOnHover("marketplace")}
          onMouseLeave={scheduleMenuHoverClose}
        >
          <button
            type="button"
            className={styles.menuTrigger}
            aria-haspopup="menu"
            aria-expanded={openMenu === "marketplace"}
            onClick={() => setOpenMenu((m) => (m === "marketplace" ? null : "marketplace"))}
          >
            Marketplace
          </button>
          {openMenu === "marketplace" && (
            <div className={styles.dropdown} role="menu">
              <button
                type="button"
                role="menuitem"
                className={styles.dropdownItem}
                disabled={glyphs.length === 0}
                onClick={() => { setMarketplaceModal("publish"); setOpenMenu(null); }}
              >
                Publish Font
              </button>
              <Link href="/marketplace" role="menuitem" className={styles.dropdownItem} onClick={() => setOpenMenu(null)}>
                Browse Fonts
              </Link>
              <button
                type="button"
                role="menuitem"
                className={styles.dropdownItem}
                onClick={() => { setMarketplaceModal("share"); setOpenMenu(null); }}
              >
                Share Font
              </button>
            </div>
          )}
        </div>

        {topMode === "draw" && drawStyle === "grid" && (
          <div
            className={styles.menuItem}
            data-chrome-menu
            onMouseEnter={() => openMenuOnHover("charset")}
            onMouseLeave={scheduleMenuHoverClose}
          >
            <button
              type="button"
              className={styles.menuTrigger}
              aria-haspopup="menu"
              aria-expanded={openMenu === "charset"}
              onClick={() => setOpenMenu((m) => (m === "charset" ? null : "charset"))}
            >
              Character Sets
            </button>
            {openMenu === "charset" && (
              <div className={styles.dropdown} role="menu">
                {CHARACTER_SETS.map((set) => (
                  <label key={set.id} className={styles.charsetOption}>
                    <input type="checkbox" checked={activeSetIds.has(set.id)} onChange={() => toggleCharacterSet(set.id)} />
                    {set.label}
                  </label>
                ))}

                {extraGridSlots.length > 0 && (
                  <div className={styles.extraGlyphList}>
                    {extraGridSlots.map((slot) => (
                      <div key={`${slot.kind}:${slot.name}`} className={styles.extraGlyphRow}>
                        <span>
                          {slot.name} <span className={styles.glyphMeta}>({slot.kind})</span>
                        </span>
                        <button
                          type="button"
                          className={styles.extraGlyphRemove}
                          onClick={() => removeGridSlot(slot.name, slot.kind)}
                          aria-label={`Remove ${slot.name}`}
                          title="Remove from Grid (keeps any strokes already drawn)"
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {/* A ligature/alternate has nothing to lasso-select the way
                    Free's Assign panel does — Grid fuses capture+tagging per
                    cell, so this just appends an empty slot to draw into. */}
                <div className={styles.extraGlyphForm}>
                  <input
                    type="text"
                    className={styles.nameInput}
                    placeholder={
                      kindInput === "base"
                        ? "character (e.g. a, é)"
                        : kindInput === "ligature"
                          ? "name (e.g. f_i.liga)"
                          : "name (e.g. a.alt01)"
                    }
                    value={nameInput}
                    onChange={(e) => setNameInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        handleAddGridSlot();
                      }
                    }}
                  />
                  <div className={styles.modeToggle} role="radiogroup" aria-label="Glyph kind">
                    <button
                      type="button"
                      role="radio"
                      aria-checked={kindInput === "base"}
                      className={`${styles.modeBtn} ${kindInput === "base" ? styles.modeBtnActive : ""}`}
                      onClick={() => setKindInput("base")}
                    >
                      Base
                    </button>
                    <button
                      type="button"
                      role="radio"
                      aria-checked={kindInput === "ligature"}
                      className={`${styles.modeBtn} ${kindInput === "ligature" ? styles.modeBtnActive : ""}`}
                      onClick={() => setKindInput("ligature")}
                    >
                      Ligature
                    </button>
                    <button
                      type="button"
                      role="radio"
                      aria-checked={kindInput === "alternate"}
                      className={`${styles.modeBtn} ${kindInput === "alternate" ? styles.modeBtnActive : ""}`}
                      onClick={() => setKindInput("alternate")}
                      title="Alternate"
                    >
                      Alt
                    </button>
                  </div>
                  {kindInput === "ligature" && (
                    <input
                      type="text"
                      className={styles.nameInput}
                      placeholder="components (e.g. f, i)"
                      value={componentsInput}
                      onChange={(e) => setComponentsInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          handleAddGridSlot();
                        }
                      }}
                    />
                  )}
                  {kindInput === "alternate" && (
                    <input
                      type="text"
                      className={styles.nameInput}
                      placeholder="alternate of (e.g. a)"
                      value={alternateOfInput}
                      onChange={(e) => setAlternateOfInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          handleAddGridSlot();
                        }
                      }}
                    />
                  )}
                  <button type="button" className={styles.clearBtn} onClick={handleAddGridSlot} disabled={!nameInput.trim()}>
                    Add Glyph
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        <div className={styles.hBarGroup}>
          <button
            type="button"
            className={styles.hBarItem}
            onClick={handleUndo}
            disabled={topMode !== "draw" || undoCount === 0}
            aria-label="Undo"
            title="Undo"
          >
            <Undo2 size={16} strokeWidth={2} />
            <span>Undo</span>
          </button>
          <button
            type="button"
            className={styles.hBarItem}
            onClick={handleRedo}
            disabled={topMode !== "draw" || redoCount === 0}
            aria-label="Redo"
            title="Redo"
          >
            <Redo2 size={16} strokeWidth={2} />
            <span>Redo</span>
          </button>
        </div>
      </div>

      {topMode === "draw" && drawStyle !== "editor" && (
        <div className={styles.toolsViewsBar} data-chrome-menu>
          <div className={styles.hBarGroup}>
            <span className={styles.hBarLabel}>Tools</span>
            {visibleTools.map((t) => (
              <button
                key={t.value}
                type="button"
                className={`${styles.hBarItem} ${drawTool === t.value ? styles.hBarItemActive : ""}`}
                onClick={() => setDrawTool(t.value)}
                aria-label={`${t.label} (${t.shortcut})`}
                title={`${t.label} (${t.shortcut})`}
              >
                <t.icon size={16} strokeWidth={2} />
                <span>{t.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <input
        ref={fffInputRef}
        type="file"
        accept=".fff,application/json"
        onChange={handleImportFffChange}
        style={{ display: "none" }}
      />

      <div className={styles.body}>
        <main className={styles.main}>

      {topMode === "draw" && drawStyle === "free" && drawTool === "assign" && glyphs.length > 0 && (
        <div className={styles.glyphListWrap}>
          <div className={styles.glyphListHeader}>
            <span>{glyphs.length} tagged</span>
            <button
              type="button"
              className={styles.glyphListToggle}
              onClick={() => setGlyphListExpanded((v) => !v)}
            >
              {glyphListExpanded ? "Collapse" : "Show all"}
            </button>
          </div>
          <ul className={`${styles.glyphList} ${glyphListExpanded ? "" : styles.glyphListCollapsed}`}>
            {glyphs.map((g) => (
              <li key={g.id} className={styles.glyphItem}>
                <span className={styles.glyphName}>{g.name}</span>
                <span className={styles.glyphMeta}>
                  {g.kind === "base" && (g.unicode ?? "no unicode")}
                  {g.kind === "ligature" && `ligature: ${g.components?.join(" + ") || "—"}`}
                  {g.kind === "alternate" && `alt of ${g.alternateOf || "—"}`}
                </span>
                <span className={styles.glyphCount}>{g.strokeIds.length} strokes</span>
                <button type="button" className={styles.untagBtn} onClick={() => handleUntag(g.id)}>
                  untag
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div
        className={styles.canvasWrap}
        style={!(topMode === "draw" && drawStyle === "free") ? { display: "none" } : undefined}
      >
        <canvas ref={canvasRef} className={styles.canvas} />
        {topMode === "draw" && drawStyle === "free" && !freeDrawIntroDismissed && (
          <div className={styles.introOverlay}>
            <div className={styles.introCard}>
              <h2 className={styles.introTitle}>The Free Draw Editor</h2>
              <p className={styles.introText}>
                Here you can write freely, select and assign singly letters, numbers or other glyphs. You can also
                assign ligatures and alternate letters.
              </p>
              <h3 className={styles.introSubtitle}>How it works</h3>
              <div className={styles.introSteps}>
                <div className={styles.introStep}>
                  <span className={styles.introStepBadge}>
                    <Pencil size={16} strokeWidth={2} />
                    Draw
                  </span>
                  <p className={styles.introStepText}>Create your letter shapes</p>
                </div>
                <div className={styles.introStep}>
                  <span className={styles.introStepBadge}>
                    <Lasso size={16} strokeWidth={2} />
                    Select
                  </span>
                  <p className={styles.introStepText}>Select a letter, glyph or ligature</p>
                </div>
                <div className={styles.introStep}>
                  <span className={styles.introStepBadge}>
                    <BookA size={16} strokeWidth={2} />
                    Assign
                  </span>
                  <p className={styles.introStepText}>Assign to the respective glyph class</p>
                </div>
              </div>
              <p className={styles.introText}>
                You can then adjust the geometry or side bearings in the grid view or test them in the editor view
              </p>
              <div className={styles.introActions}>
                <button type="button" className={styles.clearBtn} onClick={dismissFreeDrawIntro}>
                  Start
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {topMode === "draw" && drawStyle === "grid" && (
        <div
          className={styles.grid}
          style={{
            // Fixed track sizes (no 1fr stretch) so a cell's actual rendered
            // pixel size always matches cellWidth/cellHeightPx exactly — the
            // anchor-space rescale math (fromAnchorSpace/toAnchorSpace)
            // assumes that equivalence and drifts if the grid is free to
            // stretch columns to fill leftover row width.
            gridTemplateColumns: `repeat(auto-fill, ${cellWidth}px)`,
            gridAutoRows: `${cellSize * CELL_ASPECT_RATIO}px`,
          }}
        >
          {gridSlots.map((slot) => {
            const { name, kind } = slot;
            const cellKey = `${kind}:${name}`;
            const glyph = glyphs.find((g) => g.kind === kind && g.name === name);
            const glyphStrokes = glyph
              ? glyph.strokeIds
                  .map((id) => completedRef.current.find((s) => s.id === id))
                  .filter((s): s is Stroke => Boolean(s))
              : [];
            const needsFit = glyph && !(glyph.cellWidth && glyph.cellHeight);
            const cellHeightPx = cellSize * CELL_ASPECT_RATIO;
            // The canvas's own measured size (once GridCell has reported
            // in) — not the nominal cellWidth/cellHeightPx, which the label
            // bar underneath already eats a few px of. Using the nominal
            // value here made a freshly-drawn stroke's anchor not quite
            // match what fromAnchorSpace later rescales against, so it
            // visibly jumped a few pixels the instant the stroke committed.
            const liveWidth = cellDims[cellKey]?.width ?? cellWidth;
            const liveHeight = cellDims[cellKey]?.height ?? cellHeightPx;
            // The geometric scale this fit/rescale applies to point
            // positions has to also apply to stroke width — otherwise a
            // Free-tagged glyph (always a dramatic scale-down, from a
            // large Free-canvas bbox to a small cell) renders with its
            // original Free-canvas ink weight, wildly too thick for the
            // shrunk letterforms.
            const fitScale = needsFit
              ? fitStrokesToCell(glyphStrokes, name, liveWidth, liveHeight, metrics)
              : {
                  points: glyphStrokes.map((s) =>
                    fromAnchorSpace(s.points, glyph?.cellWidth, glyph?.cellHeight, liveWidth, liveHeight, keepProportions)
                  ),
                  scale: anchorSpaceWidthScale(glyph?.cellWidth, glyph?.cellHeight, liveWidth, liveHeight, keepProportions),
                };
            const fittedPoints = fitScale.points;
            const cellStrokes = glyphStrokes.map((s, i) => ({
              id: s.id,
              points: fittedPoints[i],
              widthScale: (s.widthScale ?? 1) * fitScale.scale,
            }));
            return (
              <GridCell
                key={cellKey}
                label={name}
                strokes={cellStrokes}
                tool={(FREE_ONLY_TOOLS.has(drawTool) ? "pen" : drawTool) as CellTool}
                onErase={(ids) => deleteStrokes(ids)}
                onStrokesChange={(updates) => handleGridStrokesChange(slot, updates, liveWidth, liveHeight)}
                strokeOptions={optionsFor(settings)}
                onStrokeComplete={(stroke, reportedWidth, reportedHeight, durationMs) =>
                  handleGridStroke(slot, stroke, reportedWidth, reportedHeight, durationMs)
                }
                metrics={metrics}
                leftBearing={glyph?.leftBearing}
                rightBearing={glyph?.rightBearing}
                onBearingsChange={(left, right) => handleBearingsChange(slot, left, right)}
                onResize={(width, height) => handleCellResize(cellKey, width, height)}
              />
            );
          })}
        </div>
      )}

      {topMode === "draw" && drawStyle === "editor" && (
        <EditorPanel
          glyphs={glyphs}
          strokes={completedRef.current}
          metrics={metrics}
          settings={settings}
          text={editorText}
          onTextChange={updateEditorText}
          fontSize={editorFontSize}
          useLigatures={useLigatures}
        />
      )}

      {topMode === "animate" && (
        <AnimatePanel
          glyphs={glyphs}
          strokes={completedRef.current}
          metrics={metrics}
          text={animateText}
          onTextChange={setAnimateText}
          presetId={animatePresetId}
          onPresetChange={setAnimatePresetId}
        />
      )}
        </main>

        <aside className={styles.settingsPanel} data-chrome-menu>
          <div className={styles.modeToggle} role="radiogroup" aria-label="View">
            {VIEW_DEFS.map((v) => {
              const active = topMode === v.topMode && (!v.drawStyle || drawStyle === v.drawStyle);
              return (
                <button
                  key={v.key}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  className={`${styles.modeBtn} ${active ? styles.modeBtnActive : ""}`}
                  onClick={() => selectView(v)}
                >
                  {v.label.replace(" View", "")}
                </button>
              );
            })}
          </div>
          <div className={styles.settingsPanelLabel}>Settings</div>
          {topMode === "draw" && drawStyle === "free" && drawTool === "assign" && (
            <>
              <input
                type="text"
                className={styles.contextField}
                placeholder={
                  kindInput === "base" ? "character (e.g. a, é)" : kindInput === "ligature" ? "name (e.g. f_i.liga)" : "name (e.g. a.alt01)"
                }
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                onKeyDown={handleAssignKeyDown}
              />
              <div className={styles.modeToggle} role="radiogroup" aria-label="Glyph kind">
                <button
                  type="button"
                  role="radio"
                  aria-checked={kindInput === "base"}
                  className={`${styles.modeBtn} ${kindInput === "base" ? styles.modeBtnActive : ""}`}
                  onClick={() => setKindInput("base")}
                >
                  Base
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={kindInput === "ligature"}
                  className={`${styles.modeBtn} ${kindInput === "ligature" ? styles.modeBtnActive : ""}`}
                  onClick={() => setKindInput("ligature")}
                >
                  Ligature
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={kindInput === "alternate"}
                  className={`${styles.modeBtn} ${kindInput === "alternate" ? styles.modeBtnActive : ""}`}
                  onClick={() => setKindInput("alternate")}
                  title="Alternate"
                >
                  Alt
                </button>
              </div>

              {kindInput === "base" && nameInput.trim() && (
                <span className={styles.unicodeHint}>{unicodeFor(nameInput.trim()) ?? "not a single character"}</span>
              )}
              {kindInput === "ligature" && (
                <input
                  type="text"
                  className={styles.nameInput}
                  placeholder="components (e.g. f, i)"
                  value={componentsInput}
                  onChange={(e) => setComponentsInput(e.target.value)}
                  onKeyDown={handleAssignKeyDown}
                />
              )}
              {kindInput === "alternate" && (
                <input
                  type="text"
                  className={styles.nameInput}
                  placeholder="alternate of (e.g. a)"
                  value={alternateOfInput}
                  onChange={(e) => setAlternateOfInput(e.target.value)}
                  onKeyDown={handleAssignKeyDown}
                />
              )}

              <button
                type="button"
                className={styles.clearBtn}
                onClick={handleAssign}
                disabled={!nameInput.trim() || selectedIds.length === 0}
              >
                Assign ({selectedIds.length})
              </button>
              <button
                type="button"
                className={styles.clearBtn}
                onClick={() => setSelectedIds([])}
                disabled={selectedIds.length === 0}
              >
                Deselect
              </button>
            </>
          )}
          {topMode === "draw" && drawStyle === "grid" && (
            <div className={styles.sliders}>
              <label className={styles.sliderRow}>
                <span>Cell size</span>
                <input
                  type="range"
                  min={60}
                  max={240}
                  step={10}
                  value={cellSize}
                  onChange={(e) => updateCellSize(Number(e.target.value))}
                />
                <span className={styles.val}>{cellSize}</span>
              </label>
              <label className={styles.sliderRow}>
                <span>Width</span>
                <input
                  type="range"
                  min={0.5}
                  max={2}
                  step={0.05}
                  value={cellWidthRatio}
                  onChange={(e) => updateCellWidthRatio(Number(e.target.value))}
                />
                <span className={styles.val}>{cellWidthRatio.toFixed(2)}</span>
              </label>
              <label className={styles.sliderRow}>
                <span>
                  <input
                    type="checkbox"
                    checked={keepProportions}
                    onChange={(e) => updateKeepProportions(e.target.checked)}
                  />{" "}
                  Keep Proportions
                </span>
              </label>
              <label className={styles.sliderRow}>
                <span>Ascender</span>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={metrics.ascender}
                  onChange={(e) => updateMetric("ascender", Math.min(Number(e.target.value), metrics.xHeight - 0.02))}
                />
                <span className={styles.val}>{metrics.ascender.toFixed(2)}</span>
              </label>
              <label className={styles.sliderRow}>
                <span>X-height</span>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={metrics.xHeight}
                  onChange={(e) =>
                    updateMetric(
                      "xHeight",
                      Math.min(Math.max(Number(e.target.value), metrics.ascender + 0.02), metrics.baseline - 0.02)
                    )
                  }
                />
                <span className={styles.val}>{metrics.xHeight.toFixed(2)}</span>
              </label>
              <label className={styles.sliderRow}>
                <span>Baseline</span>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={metrics.baseline}
                  onChange={(e) =>
                    updateMetric(
                      "baseline",
                      Math.min(Math.max(Number(e.target.value), metrics.xHeight + 0.02), metrics.descender - 0.02)
                    )
                  }
                />
                <span className={styles.val}>{metrics.baseline.toFixed(2)}</span>
              </label>
              <label className={styles.sliderRow}>
                <span>Descender</span>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={metrics.descender}
                  onChange={(e) => updateMetric("descender", Math.max(Number(e.target.value), metrics.baseline + 0.02))}
                />
                <span className={styles.val}>{metrics.descender.toFixed(2)}</span>
              </label>
            </div>
          )}
          {topMode === "draw" && drawStyle === "free" && (
            <div className={styles.sliders}>
              <label className={styles.sliderRow}>
                <span>Line spacing</span>
                <input
                  type="range"
                  min={20}
                  max={300}
                  step={5}
                  value={lineSpacing}
                  onChange={(e) => updateLineSpacing(Number(e.target.value))}
                />
                <span className={styles.val}>{lineSpacing}</span>
              </label>
            </div>
          )}
          {topMode === "draw" && drawStyle === "free" && selectedIds.length > 0 && (
            <div className={styles.sliders}>
              <label className={styles.sliderRow}>
                <span>Skew horizontal</span>
                <input
                  type="range"
                  min={-75}
                  max={75}
                  step={1}
                  value={skewH}
                  onChange={(e) => updateSkewH(Number(e.target.value))}
                />
                <span className={styles.val}>{skewH}°</span>
              </label>
              <label className={styles.sliderRow}>
                <span>Skew vertical</span>
                <input
                  type="range"
                  min={-75}
                  max={75}
                  step={1}
                  value={skewV}
                  onChange={(e) => updateSkewV(Number(e.target.value))}
                />
                <span className={styles.val}>{skewV}°</span>
              </label>
            </div>
          )}

          {topMode === "draw" && drawStyle === "editor" && (
            <>
              <div className={styles.sliders}>
                <label className={styles.sliderRow}>
                  <span>Size</span>
                  <input
                    type="range"
                    min={12}
                    max={300}
                    step={1}
                    value={editorFontSize}
                    onChange={(e) => updateEditorFontSize(Number(e.target.value))}
                  />
                  <span className={styles.val}>{editorFontSize}pt</span>
                </label>
                <label className={styles.sliderRow}>
                  <span>
                    <input
                      type="checkbox"
                      checked={useLigatures}
                      onChange={(e) => updateUseLigatures(e.target.checked)}
                    />{" "}
                    Ligatures
                  </span>
                </label>
              </div>
              {missingEditorGlyphs.length > 0 && (
                <div className={styles.animateWarning}>missing glyphs: {missingEditorGlyphs.join(" ")}</div>
              )}
            </>
          )}

          {showStrokeControls && (
            <div className={styles.sliders}>
              <div className={styles.modeToggle} role="radiogroup" aria-label="Stroke mode">
                <button
                  type="button"
                  role="radio"
                  aria-checked={settings.mode === "mono"}
                  className={`${styles.modeBtn} ${settings.mode === "mono" ? styles.modeBtnActive : ""}`}
                  onClick={() => updateSetting("mode", "mono")}
                >
                  Mono line
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={settings.mode === "dynamic"}
                  className={`${styles.modeBtn} ${settings.mode === "dynamic" ? styles.modeBtnActive : ""}`}
                  onClick={() => updateSetting("mode", "dynamic")}
                >
                  Dynamic
                </button>
              </div>
              <label className={styles.sliderRow}>
                <span>Size</span>
                <input
                  type="range"
                  min={4}
                  max={60}
                  step={1}
                  value={settings.size}
                  onChange={(e) => updateSetting("size", Number(e.target.value))}
                />
                <span className={styles.val}>{settings.size}</span>
              </label>
              {settings.mode === "dynamic" && (
                <>
                  <label className={styles.sliderRow}>
                    <span>Thinning</span>
                    <input
                      type="range"
                      min={-1}
                      max={1}
                      step={0.05}
                      value={settings.thinning}
                      onChange={(e) => updateSetting("thinning", Number(e.target.value))}
                    />
                    <span className={styles.val}>{settings.thinning.toFixed(2)}</span>
                  </label>
                  <label className={styles.sliderRow}>
                    <span>Smoothing</span>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={settings.smoothing}
                      onChange={(e) => updateSetting("smoothing", Number(e.target.value))}
                    />
                    <span className={styles.val}>{settings.smoothing.toFixed(2)}</span>
                  </label>
                  <label className={styles.sliderRow}>
                    <span>Streamline</span>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={settings.streamline}
                      onChange={(e) => updateSetting("streamline", Number(e.target.value))}
                    />
                    <span className={styles.val}>{settings.streamline.toFixed(2)}</span>
                  </label>
                </>
              )}
            </div>
          )}
        </aside>
      </div>

      {topMode === "draw" && (
        <div className={styles.statusBar}>
          <span className={styles.hudItem}>
            <span className={styles.hudLabel}>mode</span>
            {drawStyle === "free" ? "Free" : drawStyle === "grid" ? "Grid" : "Editor"}
          </span>
          <span className={styles.hudItem}>
            <span className={styles.hudLabel}>pointerType</span>
            {hud.pointerType}
          </span>
          <span className={styles.hudItem}>
            <span className={styles.hudLabel}>pressure</span>
            {hud.pressure.toFixed(2)}
          </span>
          <span className={styles.hudItem}>
            <span className={styles.hudLabel}>x, y</span>
            {hud.x}, {hud.y}
          </span>
          <span className={styles.hudItem}>
            <span className={styles.hudLabel}>strokesSaved</span>
            {strokeCount}
          </span>
        </div>
      )}

      {infoModal && (
        <div className={styles.modalBackdrop} onClick={() => setInfoModal(null)}>
          <div className={styles.modalCard} role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <span>{infoModal === "info" ? "Info" : "How to"}</span>
              <button type="button" className={styles.modalClose} onClick={() => setInfoModal(null)} aria-label="Close">
                ×
              </button>
            </div>
            {infoModal === "info" ? (
              <p className={styles.modalBody}>
                Fontane.Studio turns your own handwriting into a usable font. Draw letters freehand or in the letter grid,
                tag strokes to characters, then export as OTF, JSON, or a skeleton SVG — or save your work as a
                .fff project file to keep editing later.
              </p>
            ) : (
              <ol className={styles.modalList}>
                <li>
                  <strong>Draw</strong> — two ways to capture handwriting. <strong>Free</strong> is an open canvas:
                  sketch anywhere, at any size, in any order. <strong>Grid</strong> is one cell per character —
                  drawing into a cell both captures the stroke and tags it to that letter in one step, no separate
                  Assign needed. Grid cells also show shared baseline/x-height/ascender/descender guides plus
                  draggable per-glyph left/right bearings, which feed real calibration into the font export. The
                  Draw and <strong>Brush</strong> tools both capture a pressure-varying stroke the same way — Brush
                  exists for strokes that trace their own outline rather than a centerline, so it&apos;s left out of
                  Nudge/Anchor editing and the Skeleton SVG export (see below), where a true centerline is what&apos;s
                  needed.
                </li>
                <li>
                  <strong>Select + Assign</strong> (Free only) — lasso strokes with Select, then switch to Assign
                  to name the selection as a Base character, a Ligature (built from component names), or an
                  Alternate (a variant of an existing glyph). Cmd/Ctrl+Enter saves without reaching for the button.
                </li>
                <li>
                  <strong>Reshape</strong> — <strong>Nudge</strong> drags a stroke&apos;s simplified anchor points to
                  reshape its curve. <strong>Anchor</strong> goes further: click an anchor to select it (it stays
                  selected, unlike Nudge&apos;s drag-only grab), then Delete/Backspace removes it and splits the stroke
                  in two at that point. With the Pen tool active on a stroke you&apos;re already editing, clicking
                  between two anchors inserts a new one; clicking directly on one deletes it the same way.
                </li>
                <li>
                  <strong>Transform</strong> — select strokes first (Select/Assign&apos;s lasso), then Move, Rotate, or
                  Scale them as a group. Scale defaults to resizing from the selection&apos;s bottom-left corner,
                  independently per axis; hold <strong>Alt</strong> to scale from the center instead, and{" "}
                  <strong>Shift</strong> to lock proportions. Stroke thickness scales along with the geometry, so
                  resizing never leaves a shape looking disproportionately thick or thin. The Skew horizontal and
                  vertical sliders (shown whenever a selection exists) shear it around its center — both combine
                  cleanly and the whole gesture undoes in one step.
                </li>
                <li>
                  <strong>Preview</strong> — compose text in Editor using already-tagged glyphs, or animate it in
                  Anim.
                </li>
                <li>
                  <strong>Export</strong> — File menu: <strong>OTF</strong> (a real, usable font, built entirely in
                  the browser), <strong>JSON</strong> (the compiled glyph document, for the local TTF script or the
                  Glyphs.app import script), or <strong>Skeleton SVG</strong> (every glyph&apos;s raw centerline as an
                  open path, for hand-building outlines in Glyphs.app or similar — Brush strokes are left out of
                  this one since they don&apos;t have a true centerline to export).
                </li>
                <li>
                  <strong>FFF (Fontane Font File)</strong> — File → Export/Import FFF saves or reopens the whole
                  project: every stroke, glyph, metric, and setting, exactly as the editor keeps it. This is
                  different from the OTF/JSON/Skeleton exports above, which are one-way — once a glyph&apos;s outlines
                  are compiled, the raw pen strokes behind them are gone from that file. An FFF keeps the editable
                  source data instead, so you can save your work, close the tab, and pick up exactly where you left
                  off (here, or on another machine) — it&apos;s the project save file, not a font.
                </li>
              </ol>
            )}
          </div>
        </div>
      )}

      {confirmNewFile && (
        <div className={styles.modalBackdrop} onClick={() => setConfirmNewFile(false)}>
          <div className={styles.modalCard} role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <span>New File</span>
              <button type="button" className={styles.modalClose} onClick={() => setConfirmNewFile(false)} aria-label="Close">
                ×
              </button>
            </div>
            <p className={styles.modalBody}>Save current project?</p>
            <div style={{ display: "flex", gap: 8, padding: "0 16px 16px" }}>
              <button type="button" className={styles.clearBtn} onClick={() => handleNewFile(true)}>
                Yes
              </button>
              <button type="button" className={`${styles.clearBtn} ${styles.dangerBtn}`} onClick={() => handleNewFile(false)}>
                No
              </button>
            </div>
          </div>
        </div>
      )}

      {marketplaceModal === "publish" && (
        <div className={styles.modalBackdrop} onClick={closeMarketplaceModal}>
          <div className={styles.modalCard} role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <span>Publish Font</span>
              <button type="button" className={styles.modalClose} onClick={closeMarketplaceModal} aria-label="Close">
                ×
              </button>
            </div>
            {publishedSlug ? (
              <div style={{ padding: "0 16px 16px" }}>
                <p className={styles.modalBody}>
                  Published as <strong>{publishedSlug}</strong>.
                </p>
                <div style={{ display: "flex", gap: 8 }}>
                  <button type="button" className={styles.clearBtn} onClick={() => handleShareCopy(publishedSlug)}>
                    {shareCopyState === "copied" && shareCopiedSlug === publishedSlug
                      ? "Link copied!"
                      : shareCopyState === "failed" && shareCopiedSlug === publishedSlug
                        ? "Copy failed"
                        : "Copy link"}
                  </button>
                  <a href={`/marketplace/${publishedSlug}`} className={styles.clearBtn} style={{ textDecoration: "none" }}>
                    View
                  </a>
                </div>
              </div>
            ) : glyphs.length === 0 ? (
              <p className={styles.modalBody}>Draw and tag at least one glyph before publishing.</p>
            ) : (
              <div style={{ padding: "0 16px 16px", display: "flex", flexDirection: "column", gap: 12 }}>
                <div>
                  <input
                    type="text"
                    className={styles.nameInput}
                    style={{ width: "100%" }}
                    placeholder="Font name"
                    value={publishName}
                    onChange={(e) => setPublishName(e.target.value)}
                  />
                  <p style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}>
                    {!publishName.trim()
                      ? " "
                      : slugChecking
                        ? "Checking availability…"
                        : slugCheck?.available
                          ? `Available — fontane.studio/marketplace/${slugCheck.slug}`
                          : slugCheck
                            ? "That name is already taken."
                            : " "}
                  </p>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <input
                    type="text"
                    className={styles.nameInput}
                    style={{ width: "100%" }}
                    placeholder="Author (optional)"
                    value={publishAuthorName}
                    onChange={(e) => setPublishAuthorName(e.target.value)}
                  />
                  <input
                    type="text"
                    className={styles.nameInput}
                    style={{ width: "100%" }}
                    placeholder="Author homepage (optional)"
                    value={publishAuthorUrl}
                    onChange={(e) => setPublishAuthorUrl(e.target.value)}
                  />
                </div>
                <label style={{ display: "flex", gap: 8, fontSize: 13, alignItems: "flex-start" }}>
                  <input
                    type="checkbox"
                    checked={licenseAccepted}
                    onChange={(e) => setLicenseAccepted(e.target.checked)}
                    style={{ marginTop: 2 }}
                  />
                  I confirm this font may be used 100% unrestricted, for any purpose.
                </label>
                {publishError && <p style={{ color: "#c0334d", fontSize: 13 }}>{publishError}</p>}
                <button
                  type="button"
                  className={styles.clearBtn}
                  disabled={!slugCheck?.available || !licenseAccepted || publishing}
                  onClick={handlePublish}
                >
                  {publishing ? "Publishing…" : "Publish"}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {marketplaceModal === "share" && (
        <div className={styles.modalBackdrop} onClick={closeMarketplaceModal}>
          <div className={styles.modalCard} role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <span>Share Font</span>
              <button type="button" className={styles.modalClose} onClick={closeMarketplaceModal} aria-label="Close">
                ×
              </button>
            </div>
            <div style={{ padding: "0 16px 16px", display: "flex", flexDirection: "column", gap: 8 }}>
              <input
                type="text"
                className={styles.nameInput}
                style={{ width: "100%" }}
                placeholder="Find a published font by name"
                value={shareQuery}
                onChange={(e) => setShareQuery(e.target.value)}
              />
              {shareSearching && <p style={{ fontSize: 12, opacity: 0.7 }}>Searching…</p>}
              {!shareSearching && shareQuery.trim() && shareResults.length === 0 && (
                <p style={{ fontSize: 12, opacity: 0.7 }}>No fonts found.</p>
              )}
              {shareResults.map((font) => (
                <div key={font.slug} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                  <span>{font.display_name}</span>
                  <button type="button" className={styles.clearBtn} onClick={() => handleShareCopy(font.slug)}>
                    {shareCopyState === "copied" && shareCopiedSlug === font.slug
                      ? "Copied!"
                      : shareCopyState === "failed" && shareCopiedSlug === font.slug
                        ? "Failed"
                        : "Copy link"}
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
