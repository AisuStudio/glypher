# Fontane

A web/PWA tool for capturing hand lettering (Apple Pencil, Wacom, mouse/trackpad as fallback — the Pointer Events API is device-agnostic) and turning it into a font with contextual alternates.

## Modes

- **Write** — free-form canvas: Draw a letter/ligature, lasso-select strokes in Review, tag them with a name, export in Export.
- **Grid** — one cell per character, draw directly into a cell (fuses capture + tagging). Cells show global baseline/x-height/ascender/descender guides and per-glyph draggable left/right bearings — these double as real calibration for the font export.

## Pipeline

1. **Capture** — pointer position + pressure
2. **Live-render** — variable stroke width (perfect-freehand)
3. **Tag** — Write mode's lasso-select, or Grid mode's draw-into-a-cell
4. **Outline generation** — centerline + pressure → quadratic Bezier contour, overlapping strokes in one glyph merged via polygon union

All of the above feed a shared, editable JSON document (Export tab). From there, export branches three ways:

- **Live OTF** (Export tab → "Export OTF") — built entirely client-side via `opentype.js` (`src/lib/exportFont.ts`), no extra tooling needed.
- **Local TTF** ([`font-build/`](./font-build)) — a Python + `fontTools` script for a real TrueType (`glyf`-table) `.ttf` instead of the in-app CFF-flavored `.otf`.
- **Skeleton SVG** (Export tab → "Export Skeleton SVG") — every glyph's raw pen centerline as an open path, for hand-building a stroke-width outline in Glyphs.app or similar.
- **Glyphs bridge** (full Glyphs license only — Glyphs Mini doesn't support scripts/plugins): [`glyphs-plugin/`](./glyphs-plugin) has a Script that reads the JSON directly and builds real glyphs + outlines in the currently open font.

Export (Export tab) also branches into an **FFF** ("Fontane Font File", `src/lib/projectFile.ts`) project save — the raw editable glyphs/strokes/metrics/settings, for reopening and continuing to edit later (as opposed to the compiled JSON/OTF/skeleton exports above, which drop that editable source data).

Design tokens come from [waffle](https://github.com/AisuStudio/waffle).

## Status

Write mode and Grid mode are both functional with local persistence. Grid View has adjustable global metrics (ascender/x-height/baseline/descender) and per-glyph draggable bearings, which feed real calibration into the OTF/TTF exports for Grid-drawn glyphs — Write-mode-tagged glyphs fall back to a per-glyph bounding-box rescale. The Glyphs import script exists but is untested against real Glyphs.app (see its README).

## Development

```bash
npm run dev
```
