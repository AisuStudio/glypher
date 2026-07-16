export type StrokePoint = [x: number, y: number, pressure: number];

export type Stroke = {
  id: string;
  points: StrokePoint[];
  createdAt: number;
};

const STORAGE_KEY = "fontane.strokes.v1";
const LEGACY_STORAGE_KEY = "glypher.strokes.v1"; // pre-rename data, read as a fallback so nothing is lost

export function loadStrokes(): Stroke[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY) ?? window.localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveStrokes(strokes: Stroke[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(strokes));
}

export function clearStrokes() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(STORAGE_KEY);
}
