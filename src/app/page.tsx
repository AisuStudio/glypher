"use client";

import { useEffect, useRef, useState } from "react";
import { getStroke } from "perfect-freehand";
import styles from "./page.module.css";
import { clearStrokes, loadStrokes, saveStrokes, type Stroke, type StrokePoint } from "@/lib/strokes";
import { loadGlyphs, saveGlyphs, unicodeFor, type Glyph, type GlyphKind } from "@/lib/glyphs";
import { anyPointInPolygon } from "@/lib/geometry";
import { outlineToPath, pathToSvgD, type PathCommand } from "@/lib/contour";
import { Undo2, Redo2 } from "lucide-react";
import GridCell from "./GridCell";
import BetaBadge from "./BetaBadge";
import { CHARACTER_SETS, DEFAULT_CHARACTER_SET_IDS } from "@/lib/charsets";

type TopMode = "write" | "grid";
type ViewMode = "draw" | "review" | "export";
type StrokeMode = "mono" | "dynamic";

type StrokeSettings = {
  mode: StrokeMode;
  size: number;
  thinning: number;
  smoothing: number;
  streamline: number;
};

const DEFAULT_SETTINGS: StrokeSettings = {
  mode: "dynamic",
  size: 20,
  thinning: 0.7,
  smoothing: 0.5,
  streamline: 0.5,
};

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
function compileDocument(glyphs: Glyph[], strokes: Stroke[], settings: StrokeSettings) {
  const byId = new Map(strokes.map((s) => [s.id, s]));
  return {
    version: 1,
    settings: optionsFor(settings),
    glyphs: glyphs.map((g) => ({
      name: g.name,
      kind: g.kind,
      unicode: g.unicode,
      components: g.components,
      alternateOf: g.alternateOf,
      contours: g.strokeIds
        .map((id) => byId.get(id))
        .filter((s): s is Stroke => Boolean(s))
        .map((s) => pathToSvgD(outlineToPath(outlineFor(s.points, settings)))),
    })),
  };
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

  const [topMode, setTopMode] = useState<TopMode>("write");
  const [activeSetIds, setActiveSetIds] = useState<Set<string>>(new Set(DEFAULT_CHARACTER_SET_IDS));
  const gridChars = CHARACTER_SETS.filter((s) => activeSetIds.has(s.id)).flatMap((s) => s.chars);

  function toggleCharacterSet(id: string) {
    setActiveSetIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const [viewMode, setViewMode] = useState<ViewMode>("draw");
  const viewModeRef = useRef(viewMode);
  const showStrokeControls = (topMode === "write" && viewMode === "draw") || topMode === "grid";

  const [settings, setSettings] = useState<StrokeSettings>(DEFAULT_SETTINGS);
  const settingsRef = useRef(settings);

  // Lazy initializer, not useEffect + setGlyphs([]) then load: starting from an empty
  // array and loading afterward would let the save-on-change effect below fire once
  // with [] and clobber whatever was already in storage before the real data arrives.
  const [glyphs, setGlyphs] = useState<Glyph[]>(() => loadGlyphs());
  const taggedIdsRef = useRef<Set<string>>(new Set());

  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const selectedIdsRef = useRef<Set<string>>(new Set());

  const [nameInput, setNameInput] = useState("");
  const [kindInput, setKindInput] = useState<GlyphKind>("base");
  const [componentsInput, setComponentsInput] = useState("");
  const [alternateOfInput, setAlternateOfInput] = useState("");

  const [hud, setHud] = useState({ pointerType: "—", pressure: 0, x: 0, y: 0 });
  const [strokeCount, setStrokeCount] = useState(0);
  const [redoCount, setRedoCount] = useState(0);
  const [exportJson, setExportJson] = useState("");

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    function redraw() {
      if (!canvas || !ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
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
      if (viewModeRef.current === "draw" && currentPointsRef.current.length > 0) {
        fillOutline(ctx, outlineFor(currentPointsRef.current, settingsRef.current), COLOR_DEFAULT);
      }
      if (viewModeRef.current === "review" && lassoRef.current.length > 1) {
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
      drawingRef.current = true;
      const p = pointFromEvent(e);
      if (viewModeRef.current === "draw") {
        currentPointsRef.current = [p];
      } else {
        lassoRef.current = [[p[0], p[1]]];
      }
      setHud({ pointerType: e.pointerType, pressure: e.pressure, x: Math.round(p[0]), y: Math.round(p[1]) });
    }

    function onPointerMove(e: PointerEvent) {
      const p = pointFromEvent(e);
      setHud({ pointerType: e.pointerType, pressure: e.pressure, x: Math.round(p[0]), y: Math.round(p[1]) });
      if (!drawingRef.current) return;
      if (viewModeRef.current === "draw") {
        currentPointsRef.current.push(p);
      } else {
        lassoRef.current.push([p[0], p[1]]);
      }
      redraw();
    }

    function onPointerUp(e: PointerEvent) {
      if (viewModeRef.current === "draw") {
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
    outlinesRef.current = completedRef.current.map((s) => outlineFor(s.points, settings));
    redrawRef.current();
  }, [settings]);

  useEffect(() => {
    viewModeRef.current = viewMode;
    currentPointsRef.current = [];
    lassoRef.current = [];
    setSelectedIds([]);
    redrawRef.current();
  }, [viewMode]);

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
    if (viewMode !== "export") return;
    const doc = compileDocument(glyphs, completedRef.current, settings);
    setExportJson(JSON.stringify(doc, null, 2));
  }, [viewMode, glyphs, settings]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "z") return;
      if (viewModeRef.current !== "draw") return;
      e.preventDefault();
      if (e.shiftKey) redoRef.current();
      else undoRef.current();
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
    // has to untie that too — same orphan cleanup as handleDeleteSelection.
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

  function handleDeleteSelection() {
    if (selectedIds.length === 0) return;
    const idsToDelete = new Set(selectedIds);
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
    setSelectedIds([]);
  }

  function handleGridStroke(letter: string, stroke: Stroke) {
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
      };
      return [...gs, glyph];
    });
  }

  function handleDownloadJson() {
    const blob = new Blob([exportJson], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "glypher-document.json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return (
    <div className={styles.page}>
      <BetaBadge />
      <header className={styles.header}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/GL_Logo.svg" alt="glypher" className={styles.logo} />
        <p>
          {topMode === "grid" && "Draw directly into a letter's cell — no separate tagging step."}
          {topMode === "write" && viewMode === "draw" && "Write with a stylus, mouse, or finger. Strokes persist across reloads."}
          {topMode === "write" && viewMode === "review" && "Drag to lasso strokes, then give the selection a glyph name."}
          {topMode === "write" && viewMode === "export" && "The compiled document — every tagged glyph resolved to real contours."}
        </p>
      </header>

      <div className={styles.toolbar}>
        <div className={styles.modeToggle} role="radiogroup" aria-label="Top mode">
          <button
            type="button"
            role="radio"
            aria-checked={topMode === "write"}
            className={`${styles.modeBtn} ${topMode === "write" ? styles.modeBtnActive : ""}`}
            onClick={() => setTopMode("write")}
          >
            Write
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={topMode === "grid"}
            className={`${styles.modeBtn} ${topMode === "grid" ? styles.modeBtnActive : ""}`}
            onClick={() => setTopMode("grid")}
          >
            Grid
          </button>
        </div>

        {topMode === "grid" && (
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

        {topMode === "write" && (
        <div className={styles.modeToggle} role="radiogroup" aria-label="View mode">
          <button
            type="button"
            role="radio"
            aria-checked={viewMode === "draw"}
            className={`${styles.modeBtn} ${viewMode === "draw" ? styles.modeBtnActive : ""}`}
            onClick={() => setViewMode("draw")}
          >
            Draw
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={viewMode === "review"}
            className={`${styles.modeBtn} ${viewMode === "review" ? styles.modeBtnActive : ""}`}
            onClick={() => setViewMode("review")}
          >
            Review
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={viewMode === "export"}
            className={`${styles.modeBtn} ${viewMode === "export" ? styles.modeBtnActive : ""}`}
            onClick={() => setViewMode("export")}
          >
            Export
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

            <div className={styles.undoRedo}>
              <button
                type="button"
                className={`${styles.clearBtn} ${styles.iconBtn}`}
                onClick={handleUndo}
                disabled={strokeCount === 0}
              >
                <Undo2 size={14} strokeWidth={2} />
                Undo
              </button>
              <button
                type="button"
                className={`${styles.clearBtn} ${styles.iconBtn}`}
                onClick={handleRedo}
                disabled={redoCount === 0}
              >
                <Redo2 size={14} strokeWidth={2} />
                Redo
              </button>
            </div>
          </>
        )}

        {topMode === "write" && viewMode === "review" && (
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
              Clear selection
            </button>
            <button
              type="button"
              className={`${styles.clearBtn} ${styles.dangerBtn}`}
              onClick={handleDeleteSelection}
              disabled={selectedIds.length === 0}
            >
              Delete selection
            </button>
          </div>
        )}

        {topMode === "write" && viewMode === "export" && (
          <div className={styles.tagForm}>
            <button type="button" className={styles.clearBtn} onClick={handleDownloadJson}>
              Download JSON
            </button>
          </div>
        )}

        <button className={styles.clearBtn} onClick={handleClear} type="button">
          Clear all
        </button>
      </div>

      {topMode === "write" && viewMode === "export" && (
        <section className={styles.exportPanel}>
          <textarea className={styles.exportOutput} readOnly rows={20} value={exportJson} />
        </section>
      )}

      {topMode === "write" && viewMode === "review" && glyphs.length > 0 && (
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
        style={topMode !== "write" || viewMode === "export" ? { display: "none" } : undefined}
      >
        <canvas ref={canvasRef} className={styles.canvas} />
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
      </div>

      {topMode === "grid" && (
        <div className={styles.grid}>
          {gridChars.map((letter) => {
            const glyph = glyphs.find((g) => g.kind === "base" && g.name === letter);
            const cellOutlines = glyph
              ? glyph.strokeIds
                  .map((id) => completedRef.current.find((s) => s.id === id))
                  .filter((s): s is Stroke => Boolean(s))
                  .map((s) => outlineFor(s.points, settings))
              : [];
            return (
              <GridCell
                key={letter}
                label={letter}
                outlines={cellOutlines}
                strokeOptions={optionsFor(settings)}
                onStrokeComplete={(stroke) => handleGridStroke(letter, stroke)}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
