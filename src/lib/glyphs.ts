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

const STORAGE_KEY = "glypher.glyphs.v1";

export function loadGlyphs(): Glyph[] {
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

export function saveGlyphs(glyphs: Glyph[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(glyphs));
}

export function clearGlyphs() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(STORAGE_KEY);
}
