import { Font, Glyph, Path } from "opentype.js";
import { saveFile } from "./saveFile";

// Mirrors font-build/build_ttf.py's glyph naming/metrics/cmap conventions, but
// the actual binary output differs: opentype.js always writes a CFF-flavored
// OTF (it converts our quadratic contours to cubic internally), where the
// Python script writes a real TrueType glyf table. Both are valid, importable
// fonts — this one's just .otf, not .ttf.
const UPM = 1000;
const ASCENT = 800;
const DESCENT = -200;
const DEFAULT_ADVANCE = 600;
const SIDE_BEARING = 40;
// Canvas strokes are drawn at whatever pixel size the user happened to use, with
// no notion of "cap height." Each glyph gets its own drawn bounding box rescaled
// to this height so nothing is exported microscopic or oversized relative to a
// 1000-unit em — a reasonable cap-height-ish target, not a real calibration.
const TARGET_GLYPH_HEIGHT = 700;

type CompiledGlyph = {
  name: string;
  kind: "base" | "ligature" | "alternate";
  unicode?: string;
  components?: string[];
  alternateOf?: string;
  contours: string[];
  // Grid View guides — present only for glyphs drawn in Grid View, where a
  // shared baseline/ascender/descender plus per-glyph bearings give a real
  // calibration instead of a per-glyph bounding-box guess.
  leftBearing?: number;
  rightBearing?: number;
  cellWidth?: number;
  cellHeight?: number;
};

type DocMetrics = { ascender: number; baseline: number; descender: number };

type CompiledDocument = {
  version: number;
  glyphs: CompiledGlyph[];
  metrics?: DocMetrics;
};

type RawCommand =
  | { type: "M"; x: number; y: number }
  | { type: "Q"; cx: number; cy: number; x: number; y: number }
  | { type: "Z" };

const TOKEN_RE = /[MQZ]|-?\d+(?:\.\d+)?/g;

// Parses one "M x y Q cx cy x y Q ... Z" path string (src/lib/contour.ts
// output) into structured commands — same token shape as build_ttf.py's regex
// tokenizer, just kept as data instead of being fed straight into a pen, so a
// bounding box can be computed before anything gets drawn.
function parseContour(d: string): RawCommand[] {
  const tokens = d.match(TOKEN_RE) ?? [];
  const commands: RawCommand[] = [];
  let i = 0;
  while (i < tokens.length) {
    const tok = tokens[i];
    if (tok === "M") {
      commands.push({ type: "M", x: Number(tokens[i + 1]), y: Number(tokens[i + 2]) });
      i += 3;
    } else if (tok === "Q") {
      commands.push({
        type: "Q",
        cx: Number(tokens[i + 1]),
        cy: Number(tokens[i + 2]),
        x: Number(tokens[i + 3]),
        y: Number(tokens[i + 4]),
      });
      i += 5;
    } else {
      commands.push({ type: "Z" });
      i += 1;
    }
  }
  return commands;
}

function boundsOf(contours: RawCommand[][]): { xmin: number; xmax: number; ymin: number; ymax: number } | null {
  let xmin = Infinity;
  let xmax = -Infinity;
  let ymin = Infinity;
  let ymax = -Infinity;
  for (const commands of contours) {
    for (const c of commands) {
      if (c.type === "Z") continue;
      xmin = Math.min(xmin, c.x);
      xmax = Math.max(xmax, c.x);
      ymin = Math.min(ymin, c.y);
      ymax = Math.max(ymax, c.y);
    }
  }
  return xmin === Infinity ? null : { xmin, xmax, ymin, ymax };
}

// Canvas space is x-right/y-down with no baseline; font space is x-right/y-up
// with y=0 as the baseline. tx/ty carry the actual mapping — either guide-
// based (see glyphTransform below) or the bbox-fallback in buildFont — so this
// stays agnostic to which. Applied uniformly to on-curve and control points
// alike, which is safe: an affine transform commutes with quadratic Bezier
// evaluation.
function addContourToPath(path: Path, commands: RawCommand[], tx: (x: number) => number, ty: (y: number) => number) {
  let started = false;
  for (const c of commands) {
    if (c.type === "M") {
      path.moveTo(tx(c.x), ty(c.y));
      started = true;
    } else if (c.type === "Q") {
      path.quadraticCurveTo(tx(c.cx), ty(c.cy), tx(c.x), ty(c.y));
    } else if (started) {
      path.close();
    }
  }
}

type Transform = { tx: (x: number) => number; ty: (y: number) => number; advanceWidth: number };

// Grid View glyphs carry a real calibration: the document's shared baseline/
// ascender fractions plus this glyph's own draggable left/right bearings,
// both resolved against the cell's pixel size at draw time (cellWidth/
// cellHeight — captured once so a later window resize can't shift already-
// drawn glyphs relative to each other).
function guideTransform(entry: CompiledGlyph, metrics: DocMetrics): Transform | null {
  const { leftBearing, rightBearing, cellWidth, cellHeight } = entry;
  if (leftBearing == null || rightBearing == null || !cellWidth || !cellHeight) return null;

  const baselinePx = metrics.baseline * cellHeight;
  const ascenderPx = metrics.ascender * cellHeight;
  const leftPx = leftBearing * cellWidth;
  const rightPx = rightBearing * cellWidth;

  const span = baselinePx - ascenderPx;
  const scale = span > 0 ? ASCENT / span : 1;

  return {
    tx: (x) => (x - leftPx) * scale,
    ty: (y) => (baselinePx - y) * scale,
    advanceWidth: Math.max(Math.round((rightPx - leftPx) * scale), 1),
  };
}

// Fallback for glyphs with no Grid View guide data (e.g. tagged via Write
// mode's lasso-select): rescale the glyph's own drawn bounding box to a fixed
// cap-height-ish target. No cross-glyph consistency, but nothing comes out
// microscopic, oversized, or upside-down either.
function bboxTransform(contours: RawCommand[][]): Transform | null {
  const bbox = boundsOf(contours);
  if (!bbox) return null;
  const height = bbox.ymax - bbox.ymin;
  const scale = height > 0 ? TARGET_GLYPH_HEIGHT / height : 1;
  return {
    tx: (x) => (x - bbox.xmin) * scale + SIDE_BEARING,
    ty: (y) => (bbox.ymax - y) * scale,
    advanceWidth: Math.max(Math.round((bbox.xmax - bbox.xmin) * scale + 2 * SIDE_BEARING), 1),
  };
}

function glyphNameFor(entry: CompiledGlyph): string {
  if (entry.kind === "ligature" && entry.components?.length) {
    return entry.components.join("_") + ".liga";
  }
  return entry.name;
}

export function buildFont(doc: CompiledDocument, familyName = "Glypher Sketch"): Font {
  const notdefGlyph = new Glyph({
    name: ".notdef",
    advanceWidth: DEFAULT_ADVANCE,
    path: new Path(),
  });

  const glyphs: Glyph[] = [notdefGlyph];

  for (const entry of doc.glyphs) {
    const contours = entry.contours.map(parseContour);
    const transform = (doc.metrics && guideTransform(entry, doc.metrics)) ?? bboxTransform(contours);

    const path = new Path();
    let advanceWidth = DEFAULT_ADVANCE;

    if (transform) {
      for (const commands of contours) addContourToPath(path, commands, transform.tx, transform.ty);
      advanceWidth = transform.advanceWidth;
    }

    const unicodes =
      entry.kind === "base" && entry.unicode
        ? [parseInt(entry.unicode.replace("U+", ""), 16)]
        : undefined;

    glyphs.push(
      new Glyph({
        name: glyphNameFor(entry),
        unicodes,
        advanceWidth,
        path,
      })
    );
  }

  return new Font({
    familyName,
    styleName: "Regular",
    unitsPerEm: UPM,
    ascender: ASCENT,
    descender: DESCENT,
    glyphs,
  });
}

export function downloadFont(doc: CompiledDocument, fileName = "glypher.otf") {
  const font = buildFont(doc);
  const blob = new Blob([font.toArrayBuffer()], { type: "font/otf" });
  saveFile(blob, {
    suggestedName: fileName,
    mimeType: "font/otf",
    extension: "otf",
    description: "OpenType font",
  });
}
