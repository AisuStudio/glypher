import polygonClipping, { type Polygon, type MultiPolygon } from "polygon-clipping";

export type PathCommand =
  | { type: "M"; x: number; y: number }
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

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

export function pathToSvgD(commands: PathCommand[]): string {
  return commands
    .map((c) => {
      if (c.type === "M") return `M${round(c.x)} ${round(c.y)}`;
      if (c.type === "Q") return `Q${round(c.cx)} ${round(c.cy)} ${round(c.x)} ${round(c.y)}`;
      return "Z";
    })
    .join(" ");
}
