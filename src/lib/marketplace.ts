import { parse as parseFont } from "opentype.js";

// Shared between the publish/download route and both marketplace pages so
// the Storage URL shape lives in exactly one place.
export function publicFontUrl(slug: string): string {
  return `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/fonts/${slug}.otf`;
}

// Fixed specimen line shown wherever a published font is previewed (overview
// page, browse cards) — always the same phrase so fonts are easy to compare
// side by side, same idea as Google Fonts' pangram cards.
export const SAMPLE_TEXT = "Quick brown Jox fumps over the dazy Log";

export type FontGlyphSpecimen = { name: string; d: string; advanceWidth: number };
export type FontGlyphSheet = { glyphs: FontGlyphSpecimen[]; unitsPerEm: number; ascender: number; descender: number };

// Server-side only (fetches the published binary directly). Reads each
// glyph's own vector outline rather than rendering text through @font-face —
// this project's exported fonts have no GSUB table (see
// glyphs-plugin/README.md), so a ligature or alternate glyph has no cmap
// entry and no way to be triggered by typing ordinary text. Walking every
// glyph in the font directly is the only way to show all of them, not just
// the ones reachable that way.
export async function getFontGlyphSheet(slug: string): Promise<FontGlyphSheet | null> {
  try {
    const res = await fetch(publicFontUrl(slug), { cache: "no-store" });
    if (!res.ok) return null;
    const buffer = await res.arrayBuffer();
    const font = parseFont(buffer);
    const unitsPerEm = font.unitsPerEm || 1000;
    const ascender = font.ascender || unitsPerEm * 0.8;
    const descender = font.descender || -unitsPerEm * 0.2;
    const glyphs: FontGlyphSpecimen[] = [];
    // Glyph index 0 is always .notdef — not a real character, skip it.
    for (let i = 1; i < font.glyphs.length; i++) {
      const g = font.glyphs.get(i);
      if (!g.path || g.path.commands.length === 0) continue; // e.g. space — nothing to draw
      const path = g.getPath(0, 0, unitsPerEm);
      glyphs.push({
        name: g.name || `glyph${i}`,
        d: path.toPathData(1),
        advanceWidth: g.advanceWidth || unitsPerEm * 0.6,
      });
    }
    return { glyphs, unitsPerEm, ascender, descender };
  } catch {
    return null;
  }
}
