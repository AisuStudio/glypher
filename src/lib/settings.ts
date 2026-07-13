export type StrokeMode = "mono" | "dynamic";

export type StrokeSettings = {
  mode: StrokeMode;
  size: number;
  thinning: number;
  smoothing: number;
  streamline: number;
};

export const DEFAULT_SETTINGS: StrokeSettings = {
  mode: "dynamic",
  size: 20,
  thinning: 0.7,
  smoothing: 0.5,
  streamline: 0.5,
};

const STORAGE_KEY = "glypher.settings.v1";

export function loadSettings(): StrokeSettings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: StrokeSettings) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}
