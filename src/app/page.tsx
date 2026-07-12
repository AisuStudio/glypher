"use client";

import { useEffect, useRef, useState } from "react";
import { getStroke } from "perfect-freehand";
import styles from "./page.module.css";
import { clearStrokes, loadStrokes, saveStrokes, type Stroke, type StrokePoint } from "@/lib/strokes";

type Mode = "mono" | "dynamic";

type StrokeSettings = {
  mode: Mode;
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

function fillOutline(ctx: CanvasRenderingContext2D, outline: [number, number][]) {
  if (outline.length < 3) return;
  // Connect outline points with quadratic curves through their midpoints instead of
  // straight lines — perfect-freehand's raw polygon looks faceted otherwise.
  ctx.beginPath();
  ctx.moveTo(outline[0][0], outline[0][1]);
  for (let i = 0; i < outline.length; i++) {
    const [x0, y0] = outline[i];
    const [x1, y1] = outline[(i + 1) % outline.length];
    ctx.quadraticCurveTo(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
  }
  ctx.closePath();
  ctx.fillStyle = "#1f1934";
  ctx.fill();
}

export default function Home() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);

  // Completed strokes + their cached outlines (recomputed only when a stroke is added
  // or settings change — not on every pointer move).
  const completedRef = useRef<Stroke[]>([]);
  const outlinesRef = useRef<[number, number][][]>([]);
  const currentPointsRef = useRef<StrokePoint[]>([]);
  const redrawRef = useRef<() => void>(() => {});

  const [settings, setSettings] = useState<StrokeSettings>(DEFAULT_SETTINGS);
  const settingsRef = useRef(settings);

  const [hud, setHud] = useState({ pointerType: "—", pressure: 0, x: 0, y: 0 });
  const [strokeCount, setStrokeCount] = useState(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    function redraw() {
      if (!canvas || !ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (const outline of outlinesRef.current) fillOutline(ctx, outline);
      if (currentPointsRef.current.length > 0) {
        fillOutline(ctx, outlineFor(currentPointsRef.current, settingsRef.current));
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

    // Restore persisted strokes.
    completedRef.current = loadStrokes();
    outlinesRef.current = completedRef.current.map((s) => outlineFor(s.points, settingsRef.current));
    setStrokeCount(completedRef.current.length);

    resize();
    window.addEventListener("resize", resize);

    function pointFromEvent(e: PointerEvent): StrokePoint {
      const rect = canvas!.getBoundingClientRect();
      return [e.clientX - rect.left, e.clientY - rect.top, e.pressure > 0 ? e.pressure : 0.5];
    }

    function onPointerDown(e: PointerEvent) {
      canvas!.setPointerCapture(e.pointerId);
      drawingRef.current = true;
      currentPointsRef.current = [pointFromEvent(e)];
      const [x, y] = currentPointsRef.current[0];
      setHud({ pointerType: e.pointerType, pressure: e.pressure, x: Math.round(x), y: Math.round(y) });
    }

    function onPointerMove(e: PointerEvent) {
      const p = pointFromEvent(e);
      setHud({ pointerType: e.pointerType, pressure: e.pressure, x: Math.round(p[0]), y: Math.round(p[1]) });
      if (!drawingRef.current) return;
      currentPointsRef.current.push(p);
      redraw();
    }

    function onPointerUp(e: PointerEvent) {
      if (drawingRef.current && currentPointsRef.current.length > 1) {
        const stroke: Stroke = {
          id: `${Date.now()}-${Math.round(Math.random() * 1e6)}`,
          points: currentPointsRef.current,
          createdAt: Date.now(),
        };
        completedRef.current = [...completedRef.current, stroke];
        outlinesRef.current = [...outlinesRef.current, outlineFor(stroke.points, settingsRef.current)];
        saveStrokes(completedRef.current);
        setStrokeCount(completedRef.current.length);
      }
      drawingRef.current = false;
      currentPointsRef.current = [];
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

  function handleClear() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    completedRef.current = [];
    outlinesRef.current = [];
    clearStrokes();
    setStrokeCount(0);
  }

  function updateSetting<K extends keyof StrokeSettings>(key: K, value: StrokeSettings[K]) {
    setSettings((s) => ({ ...s, [key]: value }));
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1>glypher — phase 1 capture</h1>
        <p>Write with a stylus, mouse, or finger. Strokes persist across reloads.</p>
      </header>

      <div className={styles.toolbar}>
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

        <button className={styles.clearBtn} onClick={handleClear} type="button">
          Clear
        </button>
      </div>

      <div className={styles.canvasWrap}>
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
    </div>
  );
}
