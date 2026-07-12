# letter.space → TTF export

**Most people don't need this.** The Export tab in the web app has an
"Export OTF" button that builds a font entirely client-side (via
`opentype.js`, see `src/lib/exportFont.ts`) — no download-JSON-then-run-a-
script step. This local Python script is the alternative path for people who
specifically want a real TrueType (`glyf`-table) `.ttf` instead of the
in-app CFF-flavored `.otf`, or who want to script/batch the build.

A local Python script that compiles a `letterspace-document.json` (Export tab
→ Download JSON in the letter.space web app) into a real `.ttf` font — no
Glyphs.app, no hosted backend, just `fontTools` on your own machine.

**Why TTF, not OTF:** letter.space's exported outlines are quadratic curves
(`M`/`Q`/`Z`, see `src/lib/contour.ts`), which is exactly what TrueType's
`glyf` table stores natively. OTF/CFF wants cubic curves, which would mean an
extra conversion step for no real benefit — a hand-lettering font doesn't
need anything CFF-specific. `build_ttf.py` builds the `glyf` table directly
from the parsed path data via `fontTools`' `FontBuilder` + `TTGlyphPen`,
skipping UFO/`ufo2ft` entirely.

## Requirements

```bash
pip3 install fonttools
```

## Use

```bash
python3 build_ttf.py letterspace-document.json output.ttf
```

- `kind: "base"` glyphs get mapped in the font's cmap from their exported
  Unicode codepoint, so typing that character shows the glyph.
- `kind: "ligature"` glyphs are renamed to the underscore-joined form of
  their `components` (e.g. `f`+`i` → `f_i.liga`) — same convention as the
  Glyphs.app import script, so a font built here and one built via Glyphs
  agree on glyph names. Note: unlike Glyphs, this script does **not**
  auto-generate a `liga` OpenType feature — the glyph exists in the font but
  isn't wired to substitute automatically yet.
- `kind: "alternate"` glyphs import as plain named glyphs, not mapped to any
  codepoint or feature (same limitation as the Glyphs path — no context
  rules yet, by design).

## What's verified vs. what isn't

Unlike the Glyphs.app import script (which I can't run — no way to test
inside Glyphs.app from here), this one **is** actually tested: ran against a
sample document, inspected the resulting `glyf`/`cmap`/`hmtx` tables
directly, confirmed the on/off-curve point flags alternate correctly for
quadratic curves, and confirmed the font saves and reloads cleanly.

Not yet handled:

- **Coordinate calibration only covers Grid View.** Glyphs drawn in Grid View
  carry the document's baseline/ascender/x-height/descender guides plus their
  own draggable left/right bearings, and this script uses those for a real
  canvas-pixel-to-font-unit calibration. Glyphs tagged via Write mode's
  lasso-select have no such guide data and fall back to a per-glyph
  bounding-box rescale — fine for a single glyph, but no cross-glyph height
  consistency. Check the proportions in a font viewer after building.
- **No `liga`/`calt` feature code.** Ligature and alternate glyphs land in
  the font but need manual OpenType feature work (in Glyphs, FontForge, or
  by hand-writing a `.fea` file and recompiling) to actually substitute.
- **Fixed advance widths per glyph**, derived from each glyph's own bounding
  box plus a flat side bearing — no kerning, no per-pair spacing.
