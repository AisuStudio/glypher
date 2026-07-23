import { saveFile } from "./saveFile";
import { saveGlyphs, type Glyph } from "./glyphs";
import { saveStrokes, type Stroke } from "./strokes";
import { saveMetrics, type Metrics } from "./metrics";
import { saveSettings, type StrokeSettings } from "./settings";
import { saveVectorShapes, type VectorShape } from "./vectorShapes";

// "FFF" (Fontane Font File) — a raw dump of exactly the state the app keeps
// in localStorage (glyphs/strokes/metrics/settings), NOT the compiled
// export (src/app/page.tsx's compileDocument/"Download JSON"). The compiled
// document has already unioned outlines and dropped the raw pen points —
// fine for feeding a font compiler, useless for continuing to edit. FFF
// keeps the editable source data instead, so a project can be saved and
// reopened (here or on another machine) to keep drawing/tagging/adjusting.
export type ProjectFile = {
  version: 1;
  glyphs: Glyph[];
  strokes: Stroke[];
  // Optional — absent on FFF files saved before the Vector tool existed,
  // treated as [] everywhere below rather than bumping `version`.
  vectorShapes?: VectorShape[];
  metrics: Metrics;
  settings: StrokeSettings;
};

export function buildProjectFile(
  glyphs: Glyph[],
  strokes: Stroke[],
  vectorShapes: VectorShape[],
  metrics: Metrics,
  settings: StrokeSettings
): ProjectFile {
  return { version: 1, glyphs, strokes, vectorShapes, metrics, settings };
}

export function downloadProjectFile(
  glyphs: Glyph[],
  strokes: Stroke[],
  vectorShapes: VectorShape[],
  metrics: Metrics,
  settings: StrokeSettings,
  fileName = "untitled.fff"
) {
  const project = buildProjectFile(glyphs, strokes, vectorShapes, metrics, settings);
  const blob = new Blob([JSON.stringify(project, null, 2)], { type: "application/json" });
  saveFile(blob, {
    suggestedName: fileName,
    mimeType: "application/json",
    extension: "fff",
    description: "Fontane Font File",
  });
}

// FFF has exactly one producer (this app) — this only guards against "not
// an FFF at all" rather than fully validating every field.
export function parseProjectFile(text: string): ProjectFile {
  const parsed = JSON.parse(text);
  if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.glyphs) || !Array.isArray(parsed.strokes)) {
    throw new Error("Not a valid Fontane Font File (.fff)");
  }
  return parsed as ProjectFile;
}

// Writes the parsed project into the same localStorage keys the app already
// loads from on mount — callers reload the page afterward so every existing
// mount-time load path (loadGlyphs/loadStrokes/loadMetrics/loadSettings)
// just picks it straight up, instead of duplicating that logic in React
// state here.
export function applyProjectFile(project: ProjectFile) {
  saveGlyphs(project.glyphs);
  saveStrokes(project.strokes);
  saveVectorShapes(project.vectorShapes ?? []);
  saveMetrics(project.metrics);
  saveSettings(project.settings);
}
