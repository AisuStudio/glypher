// Global type guides for Grid View, shared by every cell. All values are
// fractions (0-1) of a cell's own height, top-to-bottom — resolution-
// independent, since grid cells can render at different pixel sizes
// depending on viewport width.
export type Metrics = {
  ascender: number; // 0-1, distance from cell top
  xHeight: number; // 0-1, distance from cell top — between ascender and baseline
  baseline: number; // 0-1, distance from cell top
  descender: number; // 0-1, distance from cell top
};

export const DEFAULT_METRICS: Metrics = {
  ascender: 0.15,
  xHeight: 0.4,
  baseline: 0.75,
  descender: 0.95,
};

const STORAGE_KEY = "glypher.metrics.v1";

export function loadMetrics(): Metrics {
  if (typeof window === "undefined") return DEFAULT_METRICS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_METRICS;
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_METRICS, ...parsed };
  } catch {
    return DEFAULT_METRICS;
  }
}

export function saveMetrics(metrics: Metrics) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(metrics));
}
