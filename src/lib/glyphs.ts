export type GlyphKind = "base" | "ligature" | "alternate";

export type Glyph = {
  id: string;
  name: string;
  kind: GlyphKind;
  unicode?: string; // e.g. "U+0061" — auto-derived for single-codepoint base glyphs
  components?: string[]; // ligature only — names of the base glyphs it's built from
  alternateOf?: string; // alternate only — name of the glyph this is a variant of
  strokeIds: string[];
  createdAt: number;
  // Grid View only — left/right sidebearing guides, draggable per glyph, as
  // fractions (0-1) of the drawing cell's own width. cellWidth/cellHeight (in
  // CSS px) are captured once when the glyph's first stroke lands, so export
  // can convert these fractions and the global Metrics fractions into the
  // same pixel space the raw stroke points already live in.
  leftBearing?: number;
  rightBearing?: number;
  cellWidth?: number;
  cellHeight?: number;
  // Grid View only — this glyph's own cell width as a ratio of cellSize,
  // same unit as the global Width slider's cellWidthRatio (page.tsx), but
  // overriding it for just this glyph. Undefined means "follow the global
  // slider" — a narrow "i" and a wide "fi" ligature can't both look right
  // sharing one uniform cell width, so this lets a cell be manually resized
  // (drag the cell's right edge in Grid) without affecting every other cell.
  widthRatio?: number;
};

// Only meaningful for a name that's exactly one Unicode codepoint (typed straight off a
// keyboard). Composed glyphs, ligatures, and custom names just don't get one.
export function unicodeFor(name: string): string | undefined {
  if (!name) return undefined;
  const cp = name.codePointAt(0);
  if (cp === undefined) return undefined;
  if (name !== String.fromCodePoint(cp)) return undefined;
  return `U+${cp.toString(16).toUpperCase().padStart(4, "0")}`;
}

const STORAGE_KEY = "fontane.glyphs.v1";
const LEGACY_STORAGE_KEY = "glypher.glyphs.v1"; // pre-rename data, read as a fallback so nothing is lost

export function loadGlyphs(): Glyph[] {
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

export function saveGlyphs(glyphs: Glyph[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(glyphs));
}

export function clearGlyphs() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(STORAGE_KEY);
}
