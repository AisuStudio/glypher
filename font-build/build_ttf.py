#!/usr/bin/env python3
"""Compiles a glypher-document.json (Export tab -> Download JSON in the
Glypher web app) into a real .ttf font.

No UFO / ufo2ft involved: glypher's exported SVG paths are already quadratic
(M/Q/Z, see src/lib/contour.ts), which is exactly what TrueType's glyf table
stores natively. So this builds the glyf table directly from the parsed path
data via fontTools' low-level FontBuilder + TTGlyphPen, instead of round-
tripping through a UFO and a cubic-curve compiler.

Usage:
    python3 build_ttf.py glypher-document.json output.ttf
"""

import json
import re
import sys

from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen

UPM = 1000
ASCENT = 800
DESCENT = -200
DEFAULT_ADVANCE = 600
SIDE_BEARING = 40

TOKEN_RE = re.compile(r"[MQZ]|-?\d+(?:\.\d+)?")


def parse_path_into_pen(d, pen):
    """Feeds one 'M x y Q cx cy x y Q ... Z' path string into a glyph pen."""
    tokens = TOKEN_RE.findall(d)
    i = 0
    started = False
    while i < len(tokens):
        tok = tokens[i]
        if tok == "M":
            x, y = float(tokens[i + 1]), float(tokens[i + 2])
            pen.moveTo((x, y))
            started = True
            i += 3
        elif tok == "Q":
            cx, cy = float(tokens[i + 1]), float(tokens[i + 2])
            x, y = float(tokens[i + 3]), float(tokens[i + 4])
            pen.qCurveTo((cx, cy), (x, y))
            i += 5
        else:
            i += 1
    if started:
        pen.closePath()


def glyph_name_for(entry):
    # Match the naming convention the Glyphs import script also uses, so a
    # font built here and a font built via Glyphs.app agree on glyph names.
    if entry.get("kind") == "ligature" and entry.get("components"):
        return "_".join(entry["components"]) + ".liga"
    return entry["name"]


def build_font(doc, family_name="Glypher Sketch"):
    glyph_order = [".notdef"]
    cmap = {}
    glyphs = {}
    metrics = {}

    notdef_pen = TTGlyphPen(None)
    glyphs[".notdef"] = notdef_pen.glyph()
    metrics[".notdef"] = (DEFAULT_ADVANCE, 0)

    for entry in doc.get("glyphs", []):
        name = glyph_name_for(entry)
        pen = TTGlyphPen(None)
        for d in entry.get("contours", []):
            parse_path_into_pen(d, pen)
        glyph = pen.glyph()
        glyphs[name] = glyph
        glyph_order.append(name)

        if glyph.numberOfContours:
            xs = [pt[0] for pt in glyph.coordinates]
            xmin, xmax = min(xs), max(xs)
            lsb = int(xmin)
            advance = int(xmax + SIDE_BEARING)
        else:
            advance, lsb = DEFAULT_ADVANCE, 0
        metrics[name] = (max(advance, 1), lsb)

        if entry.get("kind") == "base" and entry.get("unicode"):
            codepoint = int(entry["unicode"].replace("U+", ""), 16)
            cmap[codepoint] = name

    fb = FontBuilder(UPM, isTTF=True)
    fb.setupGlyphOrder(glyph_order)
    fb.setupCharacterMap(cmap)
    fb.setupGlyf(glyphs)
    fb.setupHorizontalMetrics(metrics)
    fb.setupHorizontalHeader(ascent=ASCENT, descent=DESCENT)
    fb.setupNameTable({"familyName": family_name, "styleName": "Regular"})
    fb.setupOS2(
        sTypoAscender=ASCENT,
        sTypoDescender=DESCENT,
        usWinAscent=ASCENT,
        usWinDescent=-DESCENT,
    )
    fb.setupPost()
    return fb


def main():
    if len(sys.argv) < 3:
        print("Usage: python3 build_ttf.py <glypher-document.json> <output.ttf>")
        sys.exit(1)

    with open(sys.argv[1], "r", encoding="utf-8") as f:
        doc = json.load(f)

    fb = build_font(doc)
    fb.save(sys.argv[2])
    print(f"Wrote {sys.argv[2]} ({len(doc.get('glyphs', []))} glyphs)")


if __name__ == "__main__":
    main()
