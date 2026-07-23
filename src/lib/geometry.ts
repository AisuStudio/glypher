export function pointInPolygon(point: [number, number], polygon: [number, number][]): boolean {
  const [x, y] = point;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    const intersects = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

export function anyPointInPolygon(points: [number, number][], polygon: [number, number][]): boolean {
  if (polygon.length < 3) return false;
  return points.some((p) => pointInPolygon(p, polygon));
}

// Plain bounding-box scale+center of `points` into a `targetWidth` x
// `targetHeight` box, no letter-band semantics — unlike page.tsx's
// fitStrokesToCell (which fits into a SPECIFIC glyph's ascender/x-height/
// baseline band by name), this is for pasting arbitrary copied content into
// a Grid cell, where there's no meaningful "which letter" to fit against.
export function fitPointsToBox(
  points: [number, number][],
  targetWidth: number,
  targetHeight: number,
  padding = 0.15
): { scale: number; offsetX: number; offsetY: number } {
  if (points.length === 0) return { scale: 1, offsetX: 0, offsetY: 0 };
  let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity;
  for (const [x, y] of points) {
    xmin = Math.min(xmin, x); xmax = Math.max(xmax, x);
    ymin = Math.min(ymin, y); ymax = Math.max(ymax, y);
  }
  const w = xmax - xmin || 1;
  const h = ymax - ymin || 1;
  const availWidth = targetWidth * (1 - padding * 2);
  const availHeight = targetHeight * (1 - padding * 2);
  const scale = Math.min(availWidth / w, availHeight / h);
  const offsetX = (targetWidth - w * scale) / 2 - xmin * scale;
  const offsetY = (targetHeight - h * scale) / 2 - ymin * scale;
  return { scale, offsetX, offsetY };
}
