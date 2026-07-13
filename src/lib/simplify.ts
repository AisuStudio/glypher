// Classic recursive Douglas-Peucker polyline simplification, geometry only
// (x/y — a caller with pressure-carrying points passes just the [x,y]
// projection and uses the returned indices to look up anything else it
// needs; pressure at a retained index is a real, unmodified sample, never
// synthesized).
function perpendicularDistance(
  point: [number, number],
  lineStart: [number, number],
  lineEnd: [number, number]
): number {
  const [x, y] = point;
  const [x1, y1] = lineStart;
  const [x2, y2] = lineEnd;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return Math.hypot(x - x1, y - y1);
  const t = ((x - x1) * dx + (y - y1) * dy) / lengthSq;
  const projX = x1 + t * dx;
  const projY = y1 + t * dy;
  return Math.hypot(x - projX, y - projY);
}

// Returns the sorted list of retained indices into `points` — always
// includes index 0 and the last index.
export function simplifyIndices(points: [number, number][], tolerance: number): number[] {
  if (points.length <= 2) return points.map((_, i) => i);
  const keep = new Array(points.length).fill(false);
  keep[0] = true;
  keep[points.length - 1] = true;

  function recurse(start: number, end: number) {
    let maxDist = 0;
    let maxIdx = -1;
    for (let i = start + 1; i < end; i++) {
      const d = perpendicularDistance(points[i], points[start], points[end]);
      if (d > maxDist) {
        maxDist = d;
        maxIdx = i;
      }
    }
    if (maxIdx !== -1 && maxDist > tolerance) {
      keep[maxIdx] = true;
      recurse(start, maxIdx);
      recurse(maxIdx, end);
    }
  }
  recurse(0, points.length - 1);

  const result: number[] = [];
  for (let i = 0; i < points.length; i++) if (keep[i]) result.push(i);
  return result;
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

const MIN_ANCHORS = 3;
const MAX_ANCHORS = 20;
const MAX_ITERATIONS = 12;

// A single fixed tolerance can't work well across both a tiny serif and a
// long sweeping stroke, so the tolerance is derived from this stroke's own
// bounding-box diagonal, then iteratively rescaled to land the anchor count
// in a usable range — enough to reshape with, never so many that dragging
// one anchor is indistinguishable from the raw dense point cloud.
export function simplifyStrokeIndices(points: [number, number][]): number[] {
  if (points.length <= MIN_ANCHORS) return points.map((_, i) => i);

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
  const diagonal = Math.hypot(xmax - xmin, ymax - ymin) || 1;
  let tolerance = clamp(diagonal * 0.015, 2, 10);

  let result = simplifyIndices(points, tolerance);
  for (let i = 0; i < MAX_ITERATIONS; i++) {
    if (result.length > MAX_ANCHORS) tolerance *= 1.3;
    else if (result.length < MIN_ANCHORS) tolerance *= 0.7;
    else break;
    result = simplifyIndices(points, tolerance);
  }
  return result;
}
