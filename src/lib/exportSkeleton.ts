import { skeletonToPath, pathToSvgD, escapeXml } from "./contour";
import { saveFile } from "./saveFile";
import type { Glyph } from "./glyphs";
import type { Stroke } from "./strokes";

// A specimen-sheet SVG of every tagged glyph's raw pen path (centerline, not
// the filled perfect-freehand outline) as open paths — a "skeleton" a type
// designer can drop into Glyphs.app and run through Filter > Offset Curve (or
// similar) to build a real stroke-width outline by hand, instead of relying
// on our own filled-outline export.
const CELL_SIZE = 240;
const GAP = 24;
const LABEL_HEIGHT = 20;
const COLS = 8;

function bounds(points: [number, number][]): { xmin: number; xmax: number; ymin: number; ymax: number } | null {
  if (points.length === 0) return null;
  let xmin = Infinity;
  let xmax = -Infinity;
  let ymin = Infinity;
  let ymax = -Infinity;
  for (const [x, y] of points) {
    xmin = Math.min(xmin, x);
    xmax = Math.max(xmax, x);
    ymin = Math.min(ymin, y);
    ymax = Math.max(ymax, y);
  }
  return { xmin, xmax, ymin, ymax };
}

export function buildSkeletonSvg(glyphs: Glyph[], strokes: Stroke[]): string {
  const byId = new Map(strokes.map((s) => [s.id, s]));
  const rows = Math.max(1, Math.ceil(glyphs.length / COLS));
  const width = COLS * (CELL_SIZE + GAP) + GAP;
  const height = rows * (CELL_SIZE + LABEL_HEIGHT + GAP) + GAP;
  const inset = CELL_SIZE * 0.9;

  const groups = glyphs.map((g, i) => {
    const strokePoints = g.strokeIds
      .map((id) => byId.get(id))
      .filter((s): s is Stroke => Boolean(s))
      // A brush stroke's points trace its own edge, not a centerline —
      // running it through the Offset Curve workflow this sheet is for
      // would produce nonsense, so it's silently left out here.
      .filter((s) => (s.kind ?? "pen") === "pen")
      .map((s) => s.points.map((p) => [p[0], p[1]] as [number, number]));

    const allPoints = strokePoints.flat();
    const bbox = bounds(allPoints);

    const col = i % COLS;
    const row = Math.floor(i / COLS);
    const cellX = GAP + col * (CELL_SIZE + GAP);
    const cellY = GAP + row * (CELL_SIZE + LABEL_HEIGHT + GAP);

    let inner = "";
    if (bbox) {
      const w = bbox.xmax - bbox.xmin || 1;
      const h = bbox.ymax - bbox.ymin || 1;
      const scale = Math.min(inset / w, inset / h, 1);
      const offsetX = (CELL_SIZE - w * scale) / 2 - bbox.xmin * scale;
      const offsetY = LABEL_HEIGHT + (CELL_SIZE - h * scale) / 2 - bbox.ymin * scale;
      const paths = strokePoints
        .map((points) => `<path d="${pathToSvgD(skeletonToPath(points))}" fill="none" stroke="#000" stroke-width="1.5"/>`)
        .join("");
      inner = `<g transform="translate(${offsetX} ${offsetY}) scale(${scale})">${paths}</g>`;
    }

    return `<g transform="translate(${cellX} ${cellY})">
  <text x="0" y="${LABEL_HEIGHT - 6}" font-size="12" font-family="monospace" fill="#666">${escapeXml(g.name)}</text>
  <rect x="0" y="${LABEL_HEIGHT}" width="${CELL_SIZE}" height="${CELL_SIZE}" fill="none" stroke="#ddd" stroke-width="1"/>
  ${inner}
</g>`;
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
${groups.join("\n")}
</svg>`;
}

export function downloadSkeletonSvg(glyphs: Glyph[], strokes: Stroke[], fileName = "fontane-skeletons.svg") {
  const svg = buildSkeletonSvg(glyphs, strokes);
  const blob = new Blob([svg], { type: "image/svg+xml" });
  saveFile(blob, {
    suggestedName: fileName,
    mimeType: "image/svg+xml",
    extension: "svg",
    description: "SVG skeleton paths",
  });
}
