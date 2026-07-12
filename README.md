# glypher

A web/PWA tool for capturing hand lettering (Apple Pencil, Wacom, mouse/trackpad as fallback — the Pointer Events API is device-agnostic) and turning it into a font with contextual alternates.

## Pipeline

1. **Capture** — pointer position + pressure
2. **Live-render** — variable stroke width
3. **Review & tag** — free writing, manual lasso-select + glyph/ligature assignment (no automatic handwriting recognition, by design)
4. **Outline generation** — centerline + pressure → Bezier contour

All of the above feed a shared, editable JSON document (Export tab — copy or download `glypher-document.json`). From there, export branches two ways:

- **Glyphs bridge** (full Glyphs license only — Glyphs Mini doesn't support scripts/plugins): [`glyphs-plugin/`](./glyphs-plugin) has a Script that reads the JSON directly and builds real glyphs + outlines in the currently open font.
- **Direct compile** (Glyphs Mini or no license, not built yet): a small backend would call `fontTools`/`ufo2ft` to compile the same JSON straight to OTF/TTF/WOFF2.

Design tokens come from [waffle](https://github.com/AisuStudio/waffle).

## Status

Phases 0–3 shipped: pointer capture with mono/dynamic stroke rendering, local persistence, Draw/Review/Export modes with lasso-select + glyph tagging (base/ligature/alternate), and a compiled JSON document with real Bezier contours. The Glyphs import script exists but is untested against real Glyphs.app (see its README). Direct-compile backend not started.

## Development

```bash
npm run dev
```
