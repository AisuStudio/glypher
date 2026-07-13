"use client";

import { useEffect, useRef, useState } from "react";
import { getStroke } from "perfect-freehand";
import styles from "./page.module.css";
import { clearStrokes, loadStrokes, saveStrokes, type Stroke, type StrokePoint } from "@/lib/strokes";
import { loadGlyphs, saveGlyphs, unicodeFor, type Glyph, type GlyphKind } from "@/lib/glyphs";
import { anyPointInPolygon, pointInPolygon } from "@/lib/geometry";
import { outlineToPath, pathToSvgD, unionOutlines, type PathCommand } from "@/lib/contour";
import { downloadFont } from "@/lib/exportFont";
import { downloadSkeletonSvg } from "@/lib/exportSkeleton";
import { saveFile } from "@/lib/saveFile";
import { loadMetrics, saveMetrics, type Metrics } from "@/lib/metrics";
import { loadSettings, saveSettings, type StrokeSettings } from "@/lib/settings";
import { downloadProjectFile, parseProjectFile, applyProjectFile } from "@/lib/projectFile";
import { Undo2, Redo2, PenTool, SquareDashed, Eraser, LineSquiggle, Grid3x3, BookA, Sparkle, Download } from "lucide-react";
import GridCell, { DEFAULT_LEFT_BEARING, DEFAULT_RIGHT_BEARING } from "./GridCell";
import BetaBadge from "./BetaBadge";
import { CHARACTER_SETS, DEFAULT_CHARACTER_SET_IDS } from "@/lib/charsets";
import AnimatePanel from "./AnimatePanel";
import { DEFAULT_PRESET_ID, type AnimationPresetId } from "@/lib/animationPresets";

// Draw has two styles (Free = the old "Write" freeform canvas, Grid = one
// glyph per cell); Assign only ever applies to Free — Grid already tags a
// stroke to its glyph the moment it's drawn, so there's nothing to assign.
type TopMode = "draw" | "assign" | "animate" | "export";
type DrawStyle = "free" | "grid";
type DrawTool = "pen" | "eraser";

const COLOR_DEFAULT = "#1f1934"; // blueberry — untagged
const COLOR_SELECTED = "#d8ff01"; // lemon — pending selection
const COLOR_TAGGED = "#5100ff"; // grape — assigned to a glyph

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
          .map((s) => outlineFor(s.points, settings))
      ).map((ring) => pathToSvgD(outlineToPath(ring))),
    })),
  };
}

const GRID_SPACING = 100;
const GRID_COLOR = "#d9d7ce"; // cappuccino — subtle against the vanilla canvas background

function drawGrid(ctx: CanvasRenderingContext2D, width: number, height: number) {
  ctx.save();
  ctx.strokeStyle = GRID_COLOR;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = GRID_SPACING; x < width; x += GRID_SPACING) {
    ctx.moveTo(x + 0.5, 0);
    ctx.lineTo(x + 0.5, height);
  }
  for (let y = GRID_SPACING; y < height; y += GRID_SPACING) {
    ctx.moveTo(0, y + 0.5);
    ctx.lineTo(width, y + 0.5);
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
  const gffInputRef = useRef<HTMLInputElement | null>(null);
  const drawingRef = useRef(false);

  // Completed strokes + their cached outlines (recomputed only when a stroke is added
  // or settings change — not on every pointer move).
  const completedRef = useRef<Stroke[]>([]);
  const outlinesRef = useRef<[number, number][][]>([]);
  const currentPointsRef = useRef<StrokePoint[]>([]);
  const lassoRef = useRef<[number, number][]>([]);
  const redrawRef = useRef<() => void>(() => {});
  const redoStackRef = useRef<Stroke[]>([]);
  const undoRef = useRef<() => void>(() => {});
  const redoRef = useRef<() => void>(() => {});

  const [topMode, setTopMode] = useState<TopMode>("draw");
  const [drawStyle, setDrawStyle] = useState<DrawStyle>("free");
  const [activeSetIds, setActiveSetIds] = useState<Set<string>>(new Set(DEFAULT_CHARACTER_SET_IDS));
  const gridChars = CHARACTER_SETS.filter((s) => activeSetIds.has(s.id)).flatMap((s) => s.chars);
  const [metrics, setMetrics] = useState<Metrics>(() => loadMetrics());
  const [cellSize, setCellSize] = useState(() => {
    if (typeof window === "undefined") return 90;
    return Number(window.localStorage.getItem("glypher.cellSize.v1")) || 90;
  });

  function updateCellSize(size: number) {
    setCellSize(size);
    window.localStorage.setItem("glypher.cellSize.v1", String(size));
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
  const showStrokeControls = topMode === "draw";

  const [drawTool, setDrawTool] = useState<DrawTool>("pen");
  const drawToolRef = useRef(drawTool);

  const [settings, setSettings] = useState<StrokeSettings>(() => loadSettings());
  const settingsRef = useRef(settings);

  // Lazy initializer, not useEffect + setGlyphs([]) then load: starting from an empty
  // array and loading afterward would let the save-on-change effect below fire once
  // with [] and clobber whatever was already in storage before the real data arrives.
  const [glyphs, setGlyphs] = useState<Glyph[]>(() => loadGlyphs());
  const taggedIdsRef = useRef<Set<string>>(new Set());

  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const selectedIdsRef = useRef<Set<string>>(new Set());

  const [animateText, setAnimateText] = useState("");
  const [animatePresetId, setAnimatePresetId] = useState<AnimationPresetId>(DEFAULT_PRESET_ID);

  const [nameInput, setNameInput] = useState("");
  const [kindInput, setKindInput] = useState<GlyphKind>("base");
  const [componentsInput, setComponentsInput] = useState("");
  const [alternateOfInput, setAlternateOfInput] = useState("");

  const [hud, setHud] = useState({ pointerType: "—", pressure: 0, x: 0, y: 0 });
  const [strokeCount, setStrokeCount] = useState(0);
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
      drawGrid(ctx, canvas.clientWidth, canvas.clientHeight);
      const strokes = completedRef.current;
      const outlines = outlinesRef.current;
      for (let i = 0; i < strokes.length; i++) {
        const color = selectedIdsRef.current.has(strokes[i].id)
          ? COLOR_SELECTED
          : taggedIdsRef.current.has(strokes[i].id)
            ? COLOR_TAGGED
            : COLOR_DEFAULT;
        fillOutline(ctx, outlines[i], color);
      }
      if (topModeRef.current === "draw" && currentPointsRef.current.length > 0) {
        fillOutline(ctx, outlineFor(currentPointsRef.current, settingsRef.current), COLOR_DEFAULT);
      }
      if (topModeRef.current === "assign" && lassoRef.current.length > 1) {
        strokeLassoPath(ctx, lassoRef.current);
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
      redraw();
    }

    // Restore persisted strokes. Glyphs are already loaded via useState's lazy
    // initializer, so just prime the ref the first redraw() below will read.
    completedRef.current = loadStrokes();
    outlinesRef.current = completedRef.current.map((s) => outlineFor(s.points, settingsRef.current));
    setStrokeCount(completedRef.current.length);
    taggedIdsRef.current = new Set(glyphs.flatMap((g) => g.strokeIds));

    resize();
    window.addEventListener("resize", resize);

    function pointFromEvent(e: PointerEvent): StrokePoint {
      const rect = canvas!.getBoundingClientRect();
      return [e.clientX - rect.left, e.clientY - rect.top, e.pressure > 0 ? e.pressure : 0.5];
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
      drawingRef.current = true;
      if (topModeRef.current === "draw") {
        currentPointsRef.current = [p];
      } else {
        lassoRef.current = [[p[0], p[1]]];
      }
    }

    function onPointerMove(e: PointerEvent) {
      const p = pointFromEvent(e);
      setHud({ pointerType: e.pointerType, pressure: e.pressure, x: Math.round(p[0]), y: Math.round(p[1]) });
      if (topModeRef.current === "draw" && drawToolRef.current === "eraser") {
        canvas!.style.cursor = "crosshair";
        return;
      }
      canvas!.style.cursor = "";
      if (!drawingRef.current) return;
      if (topModeRef.current === "draw") {
        currentPointsRef.current.push(p);
      } else {
        lassoRef.current.push([p[0], p[1]]);
      }
      redraw();
    }

    function onPointerUp(e: PointerEvent) {
      if (topModeRef.current === "draw") {
        if (drawingRef.current && currentPointsRef.current.length > 1) {
          const stroke: Stroke = {
            id: `${Date.now()}-${Math.round(Math.random() * 1e6)}`,
            points: currentPointsRef.current,
            createdAt: Date.now(),
          };
          completedRef.current = [...completedRef.current, stroke];
          outlinesRef.current = [...outlinesRef.current, outlineFor(stroke.points, settingsRef.current)];
          redoStackRef.current = []; // a new stroke invalidates whatever redo history existed
          saveStrokes(completedRef.current);
          setStrokeCount(completedRef.current.length);
          setRedoCount(0);
        }
        currentPointsRef.current = [];
      } else {
        const polygon = lassoRef.current;
        const matched = completedRef.current
          .filter((s) => anyPointInPolygon(s.points.map((p) => [p[0], p[1]]) as [number, number][], polygon))
          .map((s) => s.id);
        setSelectedIds(matched);
        lassoRef.current = [];
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
    outlinesRef.current = completedRef.current.map((s) => outlineFor(s.points, settings));
    redrawRef.current();
  }, [settings]);

  useEffect(() => {
    topModeRef.current = topMode;
    currentPointsRef.current = [];
    lassoRef.current = [];
    setSelectedIds([]);
    redrawRef.current();
  }, [topMode]);

  useEffect(() => {
    drawToolRef.current = drawTool;
  }, [drawTool]);

  useEffect(() => {
    selectedIdsRef.current = new Set(selectedIds);
    redrawRef.current();
  }, [selectedIds]);

  useEffect(() => {
    taggedIdsRef.current = new Set(glyphs.flatMap((g) => g.strokeIds));
    saveGlyphs(glyphs);
    redrawRef.current();
  }, [glyphs]);

  useEffect(() => {
    if (topMode !== "export") return;
    const doc = compileDocument(glyphs, completedRef.current, settings, metrics);
    setExportJson(JSON.stringify(doc, null, 2));
    setExportDoc(doc);
  }, [topMode, glyphs, settings, metrics]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        if (topModeRef.current !== "draw") return;
        e.preventDefault();
        if (e.shiftKey) redoRef.current();
        else undoRef.current();
        return;
      }

      // P/E tool shortcuts — only in Draw, and never while the user is
      // actually typing a glyph name/text (those single-letter inputs can
      // legitimately contain "p" or "e").
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
      if (topModeRef.current !== "draw") return;
      const key = e.key.toLowerCase();
      if (key === "p") setDrawTool("pen");
      else if (key === "e") setDrawTool("eraser");
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  function handleUndo() {
    if (completedRef.current.length === 0) return;
    const last = completedRef.current[completedRef.current.length - 1];
    completedRef.current = completedRef.current.slice(0, -1);
    outlinesRef.current = outlinesRef.current.slice(0, -1);
    redoStackRef.current = [...redoStackRef.current, last];
    saveStrokes(completedRef.current);
    setStrokeCount(completedRef.current.length);
    setRedoCount(redoStackRef.current.length);
    // Grid mode ties a stroke to a glyph the moment it's drawn, so undoing it
    // has to untie that too — same orphan cleanup as deleteStrokes.
    setGlyphs((gs) =>
      gs
        .map((g) => ({ ...g, strokeIds: g.strokeIds.filter((id) => id !== last.id) }))
        .filter((g) => g.strokeIds.length > 0)
    );
    redrawRef.current();
  }
  undoRef.current = handleUndo;

  function handleRedo() {
    if (redoStackRef.current.length === 0) return;
    const stroke = redoStackRef.current[redoStackRef.current.length - 1];
    redoStackRef.current = redoStackRef.current.slice(0, -1);
    completedRef.current = [...completedRef.current, stroke];
    outlinesRef.current = [...outlinesRef.current, outlineFor(stroke.points, settingsRef.current)];
    saveStrokes(completedRef.current);
    setStrokeCount(completedRef.current.length);
    setRedoCount(redoStackRef.current.length);
    redrawRef.current();
  }
  redoRef.current = handleRedo;

  function handleClear() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    completedRef.current = [];
    outlinesRef.current = [];
    redoStackRef.current = [];
    clearStrokes();
    setStrokeCount(0);
    setRedoCount(0);
    setGlyphs([]);
    setSelectedIds([]);
  }

  function updateSetting<K extends keyof StrokeSettings>(key: K, value: StrokeSettings[K]) {
    setSettings((s) => ({ ...s, [key]: value }));
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

  function handleUntag(id: string) {
    setGlyphs((gs) => gs.filter((g) => g.id !== id));
  }

  // Shared by the Assign panel's "Clear selection" bulk path (now removed —
  // deleting moved to the Eraser tool in Draw mode) and the Eraser's
  // single-stroke click-to-delete: either way it's just "remove these ids
  // from completedRef/outlinesRef and untie them from any glyph."
  function deleteStrokes(idsToDelete: Set<string>) {
    if (idsToDelete.size === 0) return;
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

  function handleGridStroke(letter: string, stroke: Stroke, cellWidth: number, cellHeight: number) {
    completedRef.current = [...completedRef.current, stroke];
    outlinesRef.current = [...outlinesRef.current, outlineFor(stroke.points, settingsRef.current)];
    saveStrokes(completedRef.current);
    setStrokeCount(completedRef.current.length);

    // Grid drawing fuses capture + tagging: the cell you draw into IS the
    // glyph, no separate lasso-select step. First stroke creates the glyph,
    // later strokes into the same cell just add to it.
    setGlyphs((gs) => {
      const existing = gs.find((g) => g.kind === "base" && g.name === letter);
      if (existing) {
        return gs.map((g) => (g.id === existing.id ? { ...g, strokeIds: [...g.strokeIds, stroke.id] } : g));
      }
      const glyph: Glyph = {
        id: `${Date.now()}-${Math.round(Math.random() * 1e6)}`,
        name: letter,
        kind: "base",
        unicode: unicodeFor(letter),
        strokeIds: [stroke.id],
        createdAt: Date.now(),
        leftBearing: DEFAULT_LEFT_BEARING,
        rightBearing: DEFAULT_RIGHT_BEARING,
        cellWidth,
        cellHeight,
      };
      return [...gs, glyph];
    });
  }

  function handleBearingsChange(letter: string, left: number, right: number) {
    setGlyphs((gs) =>
      gs.map((g) => (g.kind === "base" && g.name === letter ? { ...g, leftBearing: left, rightBearing: right } : g))
    );
  }

  function handleDownloadJson() {
    const blob = new Blob([exportJson], { type: "application/json" });
    saveFile(blob, {
      suggestedName: "letterspace-document.json",
      mimeType: "application/json",
      extension: "json",
      description: "letter.space document",
    });
  }

  function handleExportOtf() {
    if (!exportDoc) return;
    downloadFont(exportDoc, "letterspace.otf");
  }

  function handleExportSkeleton() {
    downloadSkeletonSvg(glyphs, completedRef.current);
  }

  function handleDownloadGff() {
    downloadProjectFile(glyphs, completedRef.current, metrics, settings, "untitled.gff");
  }

  function handleImportGffClick() {
    gffInputRef.current?.click();
  }

  function handleImportGffChange(e: React.ChangeEvent<HTMLInputElement>) {
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

  return (
    <div className={styles.page}>
      <BetaBadge />
      <header className={styles.header}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/GL_Logo.svg" alt="letter.space" className={styles.logo} />

        <div className={styles.modeToggle} role="radiogroup" aria-label="Mode">
          <button
            type="button"
            role="radio"
            aria-checked={topMode === "draw"}
            className={`${styles.modeBtn} ${styles.iconOnlyBtn} ${topMode === "draw" ? styles.modeBtnActive : ""}`}
            onClick={() => setTopMode("draw")}
            aria-label="Draw"
            title="Draw"
          >
            <PenTool size={16} strokeWidth={2} />
          </button>
          {drawStyle === "free" && (
            <button
              type="button"
              role="radio"
              aria-checked={topMode === "assign"}
              className={`${styles.modeBtn} ${styles.iconOnlyBtn} ${topMode === "assign" ? styles.modeBtnActive : ""}`}
              onClick={() => setTopMode("assign")}
              aria-label="Assign"
              title="Assign"
            >
              <BookA size={16} strokeWidth={2} />
            </button>
          )}
          <button
            type="button"
            role="radio"
            aria-checked={topMode === "animate"}
            className={`${styles.modeBtn} ${styles.iconOnlyBtn} ${topMode === "animate" ? styles.modeBtnActive : ""}`}
            onClick={() => setTopMode("animate")}
            aria-label="Animate"
            title="Animate"
          >
            <Sparkle size={16} strokeWidth={2} />
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={topMode === "export"}
            className={`${styles.modeBtn} ${styles.iconOnlyBtn} ${topMode === "export" ? styles.modeBtnActive : ""}`}
            onClick={() => setTopMode("export")}
            aria-label="Export"
            title="Export"
          >
            <Download size={16} strokeWidth={2} />
          </button>
        </div>

        {topMode === "draw" && (
          <div className={styles.modeToggle} role="radiogroup" aria-label="Draw style">
            <button
              type="button"
              role="radio"
              aria-checked={drawStyle === "free"}
              className={`${styles.modeBtn} ${styles.iconOnlyBtn} ${drawStyle === "free" ? styles.modeBtnActive : ""}`}
              onClick={() => setDrawStyle("free")}
              aria-label="Free"
              title="Free"
            >
              <LineSquiggle size={16} strokeWidth={2} />
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={drawStyle === "grid"}
              className={`${styles.modeBtn} ${styles.iconOnlyBtn} ${drawStyle === "grid" ? styles.modeBtnActive : ""}`}
              onClick={() => setDrawStyle("grid")}
              aria-label="Grid"
              title="Grid"
            >
              <Grid3x3 size={16} strokeWidth={2} />
            </button>
          </div>
        )}

        {topMode === "assign" && (
          <div className={styles.modeToggle} role="radiogroup" aria-label="Assign method">
            <button
              type="button"
              role="radio"
              aria-checked={true}
              className={`${styles.modeBtn} ${styles.iconOnlyBtn} ${styles.modeBtnActive}`}
              aria-label="Select"
              title="Select"
            >
              <SquareDashed size={16} strokeWidth={2} />
            </button>
          </div>
        )}

        <div className={styles.undoRedo}>
          <button
            type="button"
            className={`${styles.clearBtn} ${styles.iconOnlyBtn}`}
            onClick={handleUndo}
            disabled={strokeCount === 0}
            aria-label="Undo"
            title="Undo"
          >
            <Undo2 size={16} strokeWidth={2} />
          </button>
          <button
            type="button"
            className={`${styles.clearBtn} ${styles.iconOnlyBtn}`}
            onClick={handleRedo}
            disabled={redoCount === 0}
            aria-label="Redo"
            title="Redo"
          >
            <Redo2 size={16} strokeWidth={2} />
          </button>
        </div>

        <button className={styles.clearBtn} onClick={handleClear} type="button">
          Clear all
        </button>

        {((topMode === "draw" && drawStyle === "free") || topMode === "assign") && (
          <dl className={styles.hud}>
            <dt>pointerType</dt>
            <dd>{hud.pointerType}</dd>
            <dt>pressure</dt>
            <dd>{hud.pressure.toFixed(2)}</dd>
            <dt>x, y</dt>
            <dd>{hud.x}, {hud.y}</dd>
            <dt>strokes saved</dt>
            <dd>{strokeCount}</dd>
          </dl>
        )}
      </header>

      <div className={styles.labBanner}>LabMode, more coming soon!</div>

      <div className={styles.toolbar}>
        {topMode === "draw" && drawStyle === "grid" && (
          <div className={styles.charsetToggle}>
            {CHARACTER_SETS.map((set) => (
              <label key={set.id} className={styles.charsetOption}>
                <input
                  type="checkbox"
                  checked={activeSetIds.has(set.id)}
                  onChange={() => toggleCharacterSet(set.id)}
                />
                {set.label}
              </label>
            ))}
          </div>
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

        {topMode === "draw" && (
          <div className={styles.modeToggle} role="radiogroup" aria-label="Draw tool">
            <button
              type="button"
              role="radio"
              aria-checked={drawTool === "pen"}
              className={`${styles.modeBtn} ${styles.iconOnlyBtn} ${drawTool === "pen" ? styles.modeBtnActive : ""}`}
              onClick={() => setDrawTool("pen")}
              aria-label="Draw (p)"
              title="Draw (p)"
            >
              <PenTool size={16} strokeWidth={2} />
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={drawTool === "eraser"}
              className={`${styles.modeBtn} ${styles.iconOnlyBtn} ${drawTool === "eraser" ? styles.modeBtnActive : ""}`}
              onClick={() => setDrawTool("eraser")}
              aria-label="Erase (e)"
              title="Erase (e)"
            >
              <Eraser size={16} strokeWidth={2} />
            </button>
          </div>
        )}

        {showStrokeControls && (
          <>
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

            <div className={styles.sliders}>
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

          </>
        )}

        {topMode === "assign" && (
          <div className={styles.tagForm}>
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
              >
                Alternate
              </button>
            </div>

            <input
              type="text"
              className={styles.nameInput}
              placeholder={
                kindInput === "base" ? "character (e.g. a, é)" : kindInput === "ligature" ? "name (e.g. f_i.liga)" : "name (e.g. a.alt01)"
              }
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
            />

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
              />
            )}
            {kindInput === "alternate" && (
              <input
                type="text"
                className={styles.nameInput}
                placeholder="alternate of (e.g. a)"
                value={alternateOfInput}
                onChange={(e) => setAlternateOfInput(e.target.value)}
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
          </div>
        )}

        {topMode === "export" && (
          <div className={styles.tagForm}>
            <button type="button" className={styles.clearBtn} onClick={handleDownloadJson}>
              Download JSON
            </button>
            <button
              type="button"
              className={styles.clearBtn}
              onClick={handleExportOtf}
              disabled={glyphs.length === 0}
            >
              Export OTF
            </button>
            <button
              type="button"
              className={styles.clearBtn}
              onClick={handleExportSkeleton}
              disabled={glyphs.length === 0}
            >
              Export Skeleton SVG
            </button>
            <button type="button" className={styles.clearBtn} onClick={handleDownloadGff}>
              Download GFF
            </button>
            <button type="button" className={styles.clearBtn} onClick={handleImportGffClick}>
              Import GFF
            </button>
            <input
              ref={gffInputRef}
              type="file"
              accept=".gff,application/json"
              onChange={handleImportGffChange}
              style={{ display: "none" }}
            />
          </div>
        )}
      </div>

      {topMode === "export" && (
        <section className={styles.exportPanel}>
          <textarea className={styles.exportOutput} readOnly rows={20} value={exportJson} />
        </section>
      )}

      {topMode === "assign" && glyphs.length > 0 && (
        <ul className={styles.glyphList}>
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
      )}

      <div
        className={styles.canvasWrap}
        style={!((topMode === "draw" && drawStyle === "free") || topMode === "assign") ? { display: "none" } : undefined}
      >
        <canvas ref={canvasRef} className={styles.canvas} />
      </div>

      {topMode === "draw" && drawStyle === "grid" && (
        <div
          className={styles.grid}
          style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${cellSize}px, 1fr))` }}
        >
          {gridChars.map((letter) => {
            const glyph = glyphs.find((g) => g.kind === "base" && g.name === letter);
            const cellStrokes = glyph
              ? glyph.strokeIds
                  .map((id) => completedRef.current.find((s) => s.id === id))
                  .filter((s): s is Stroke => Boolean(s))
                  .map((s) => ({ id: s.id, outline: outlineFor(s.points, settings) }))
              : [];
            return (
              <GridCell
                key={letter}
                label={letter}
                strokes={cellStrokes}
                tool={drawTool}
                onEraseStroke={(id) => deleteStrokes(new Set([id]))}
                strokeOptions={optionsFor(settings)}
                onStrokeComplete={(stroke, cellWidth, cellHeight) =>
                  handleGridStroke(letter, stroke, cellWidth, cellHeight)
                }
                metrics={metrics}
                leftBearing={glyph?.leftBearing}
                rightBearing={glyph?.rightBearing}
                onBearingsChange={(left, right) => handleBearingsChange(letter, left, right)}
              />
            );
          })}
        </div>
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
    </div>
  );
}
