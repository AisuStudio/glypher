import polygonClipping, { type Polygon, type MultiPolygon } from "polygon-clipping";
import type { VectorShape, BezierPoint } from "./vectorShapes";

export type PathCommand =
  | { type: "M"; x: number; y: number }
  | { type: "L"; x: number; y: number }
  | { type: "Q"; cx: number; cy: number; x: number; y: number }
  | { type: "Z" };

// Same topology as the canvas fill: curve through each outline point to the midpoint
// with its neighbor. Keeping this as the one place that logic lives means the SVG
// export always matches what's drawn on screen.
export function outlineToPath(outline: [number, number][]): PathCommand[] {
  if (outline.length < 3) return [];
  const commands: PathCommand[] = [{ type: "M", x: outline[0][0], y: outline[0][1] }];
  for (let i = 0; i < outline.length; i++) {
    const [x0, y0] = outline[i];
    const [x1, y1] = outline[(i + 1) % outline.length];
    commands.push({ type: "Q", cx: x0, cy: y0, x: (x0 + x1) / 2, y: (y0 + y1) / 2 });
  }
  commands.push({ type: "Z" });
  return commands;
}

// The raw pen path (not the filled perfect-freehand outline) as an OPEN path —
// a "skeleton"/centerline a type designer can hand to Glyphs.app's Offset
// Curve filter (or similar) to build a proper stroke-width outline manually,
// instead of relying on our own filled-outline export. Same midpoint-
// quadratic smoothing style as outlineToPath, just not wrapped into a closed
// ring: starts exactly at the first point and ends exactly at the last.
export function skeletonToPath(points: [number, number][]): PathCommand[] {
  if (points.length < 2) return [];
  if (points.length === 2) {
    return [
      { type: "M", x: points[0][0], y: points[0][1] },
      { type: "L", x: points[1][0], y: points[1][1] },
    ];
  }
  const commands: PathCommand[] = [{ type: "M", x: points[0][0], y: points[0][1] }];
  for (let i = 0; i < points.length - 2; i++) {
    const [x0, y0] = points[i];
    const [x1, y1] = points[i + 1];
    commands.push({ type: "Q", cx: x0, cy: y0, x: (x0 + x1) / 2, y: (y0 + y1) / 2 });
  }
  const secondLast = points[points.length - 2];
  const last = points[points.length - 1];
  commands.push({ type: "Q", cx: secondLast[0], cy: secondLast[1], x: last[0], y: last[1] });
  return commands;
}

// Shoelace formula. Used to drop degenerate slivers polygon-clipping can
// produce at exact intersection points (floating-point noding artifacts —
// near-zero-area rings, not real geometry).
function ringArea(ring: [number, number][]): number {
  let sum = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x0, y0] = ring[i];
    const [x1, y1] = ring[(i + 1) % ring.length];
    sum += x0 * y1 - x1 * y0;
  }
  return Math.abs(sum) / 2;
}

const MIN_RING_AREA = 0.5; // sq. canvas px — real strokes are always far larger than this

// Strokes making up one glyph are drawn independently and can overlap (e.g.
// the crossbar and stem of a "t"). Feeding each stroke's outline into the
// font as its own separate contour renders fine on canvas (nonzero fill
// handles overlaps invisibly), but overlapping/self-intersecting contours can
// glitch in stricter font rasterizers — this merges them into clean,
// non-overlapping polygons first. Output rings may include holes (e.g. a
// ring-shaped union); each ring is still just a contour to run through
// outlineToPath — the winding direction polygon-clipping assigns each ring
// is what makes nonzero-fill render holes correctly.
export function unionOutlines(outlines: [number, number][][]): [number, number][][] {
  const polygons: Polygon[] = outlines.filter((o) => o.length >= 3).map((o) => [o]);
  if (polygons.length === 0) return [];
  const merged: MultiPolygon = polygonClipping.union(polygons[0], ...polygons.slice(1));
  return merged.flat().filter((ring) => ringArea(ring) > MIN_RING_AREA);
}

// Cuts `negative` out of `positive` — used for the Vector tool's default
// "shapes punch a hole" behavior (see compileDocument() in page.tsx). Both
// arguments are expected to already be unionOutlines()'d among themselves;
// this only combines the two groups. Falls back to returning `positive`
// untouched when there's nothing to subtract, rather than erroring on an
// empty clip geometry.
export function subtractOutlines(
  positive: [number, number][][],
  negative: [number, number][][]
): [number, number][][] {
  const positivePolys: Polygon[] = positive.filter((o) => o.length >= 3).map((o) => [o]);
  const negativePolys: Polygon[] = negative.filter((o) => o.length >= 3).map((o) => [o]);
  if (positivePolys.length === 0) return [];
  if (negativePolys.length === 0) return positive.filter((o) => o.length >= 3);
  const result: MultiPolygon = polygonClipping.difference(positivePolys, negativePolys);
  return result.flat().filter((ring) => ringArea(ring) > MIN_RING_AREA);
}

// Exported so page.tsx's Vector-tool insertion hit-test can sample the same
// true curve this flattening uses, rather than a straight-line approximation
// (see findInsertionRank's stroke-anchor equivalent for why that matters).
export function cubicPoint(p0: BezierPoint, c1: BezierPoint, c2: BezierPoint, p1: BezierPoint, t: number): [number, number] {
  const mt = 1 - t;
  const a = mt * mt * mt;
  const b = 3 * mt * mt * t;
  const c = 3 * mt * t * t;
  const d = t * t * t;
  return [a * p0.x + b * c1.x + c * c2.x + d * p1.x, a * p0.y + b * c1.y + c * c2.y + d * p1.y];
}

// Dense-samples the Vector tool's true cubic Bezier anchors into a plain
// polygon — the same [number,number][] shape unionOutlines/outlineToPath
// already consume for freehand strokes. One-way and compile-time-only: the
// editable anchors+handles themselves only ever live in the VectorShape
// source (src/lib/vectorShapes.ts), same relationship FFF's raw stroke
// points have to compileDocument()'s unioned output. A segment with no
// handle on either end is a straight line (no sampling needed).
export function flattenVectorShape(shape: VectorShape, segmentsPerCurve = 24): [number, number][] {
  if (shape.anchors.length < 2) return [];
  const points: [number, number][] = [[shape.anchors[0].x, shape.anchors[0].y]];
  const segmentCount = shape.closed ? shape.anchors.length : shape.anchors.length - 1;
  for (let i = 0; i < segmentCount; i++) {
    const p0 = shape.anchors[i];
    const p1 = shape.anchors[(i + 1) % shape.anchors.length];
    if (!p0.handleOut && !p1.handleIn) {
      points.push([p1.x, p1.y]);
      continue;
    }
    const c1 = p0.handleOut ?? { x: p0.x, y: p0.y };
    const c2 = p1.handleIn ?? { x: p1.x, y: p1.y };
    for (let s = 1; s <= segmentsPerCurve; s++) {
      points.push(cubicPoint(p0, c1, c2, p1, s / segmentsPerCurve));
    }
  }
  return points;
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

export function pathToSvgD(commands: PathCommand[]): string {
  return commands
    .map((c) => {
      if (c.type === "M") return `M${round(c.x)} ${round(c.y)}`;
      if (c.type === "L") return `L${round(c.x)} ${round(c.y)}`;
      if (c.type === "Q") return `Q${round(c.cx)} ${round(c.cy)} ${round(c.x)} ${round(c.y)}`;
      return "Z";
    })
    .join(" ");
}

export function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
