# Glypher → Glyphs import script

A Glyphs.app **Script** (not a plugin bundle) that reads a `glypher-document.json`
— downloaded from the Export tab in the Glypher web app — and builds real glyphs
from it in the currently open font.

**⚠️ Untested.** I can't run Glyphs.app myself, so this has only been checked for
Python syntax errors, not against the real Glyphs API. Try it on a throwaway test
font first, and if it errors, paste me the exact message from the Macro Panel
(Window → Macro Panel) — the traceback tells me exactly what to fix.

## Requirements

Glyphs 3, with the Python module installed: **Window → Plugin Manager → Modules → Python**.

## Install

1. In Glyphs: **Script → Open Scripts Folder** (or Cmd-Shift-Y). This opens
   `~/Library/Application Support/Glyphs 3/Scripts/`.
2. Copy `Import from Glypher.py` into that folder.
3. Back in Glyphs, hold **Option** and open the Script menu — "Open Scripts
   Folder" becomes "Reload Scripts". Click it (or just restart Glyphs).
4. "Import from Glypher" now shows up in the **Script** menu.

## Use

1. In the Glypher web app: Export tab → Download JSON.
2. In Glyphs: open (or create) the font you want to import into.
3. **Script → Import from Glypher**, pick the downloaded `glypher-document.json`.
4. A summary dialog lists what got imported.

## What it does

- One glyph per entry in the JSON. `kind: "base"` gets its Unicode set
  automatically (from the character you typed in Glypher). `kind: "ligature"`
  gets renamed to the underscore-joined form of its `components` (e.g.
  `f` + `i` → `f_i.liga`) so Glyphs' automatic ligature detection picks it up
  and puts it in the `liga` feature.
- Each stroke's exported SVG path (`M`/`Q`/`Z`) becomes a real quadratic
  contour (`QCURVE` nodes) in the glyph's first master layer.
- Re-running the import with the same glyph names updates those glyphs in
  place rather than duplicating them.

## What it doesn't do (yet)

- **No coordinate calibration.** Glypher's canvas doesn't know your font's
  units-per-em or baseline — the script just flips Y (canvas grows down, font
  space grows up) and copies coordinates 1:1. Your first import will likely
  need a select-all + scale + reposition in Glyphs. Once you know a scale
  factor that works, set `SCALE` at the top of the script.
- **No feature code for alternates.** `kind: "alternate"` glyphs (`a.alt01`
  etc.) import fine as glyphs, but Glyphs only auto-wires `.ss01`–`.ss20`
  suffixes into features — `.alt` isn't one of them. Wire these into `calt`/
  a stylistic set manually in Font Info → Features, or rename to `.ssNN` if a
  plain selectable stylistic set (not context-triggered) is good enough.
- **Single master only.** Uses `font.masters[0]` — fine for a single-style
  hand-lettering font, not set up for interpolation.
