// True Bezier vector shapes — the Vector tool's data model, deliberately
// separate from Stroke (raw pressure/point capture for perfect-freehand).
// Anchors carry independent in/out control handles, same as a real
// Illustrator/Figma pen tool; undefined handleIn/handleOut means a straight
// (corner) segment on that side. See contour.ts's flattenVectorShape() for
// how this gets sampled down to a plain polygon for the union/export
// pipeline — the anchors+handles here are only ever the editable source.
export type BezierPoint = { x: number; y: number };

export type BezierAnchor = {
  x: number;
  y: number;
  handleIn?: BezierPoint;
  handleOut?: BezierPoint;
};

export type VectorShape = {
  id: string;
  anchors: BezierAnchor[];
  closed: boolean;
  createdAt: number;
};

const STORAGE_KEY = "fontane.vectorShapes.v1";

export function loadVectorShapes(): VectorShape[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveVectorShapes(shapes: VectorShape[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(shapes));
}

export function clearVectorShapes() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(STORAGE_KEY);
}
