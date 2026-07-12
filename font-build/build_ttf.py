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
# Canvas strokes are drawn at whatever pixel size the user happened to use, with
# no notion of "cap height." Each glyph gets its own drawn bounding box rescaled
# to this height so nothing comes out microscopic or oversized relative to a
# 1000-unit em - a reasonable cap-height-ish target, not a real calibration.
TARGET_GLYPH_HEIGHT = 700

TOKEN_RE = re.compile(r"[MQZ]|-?\d+(?:\.\d+)?")


def parse_path_commands(d):
    """Parses one 'M x y Q cx cy x y Q ... Z' path string into structured
    commands, kept as data (not fed straight into a pen) so a bounding box can
    be computed before anything gets drawn."""
    tokens = TOKEN_RE.findall(d)
    commands = []
    i = 0
    while i < len(tokens):
        tok = tokens[i]
        if tok == "M":
            commands.append(("M", float(tokens[i + 1]), float(tokens[i + 2])))
            i += 3
        elif tok == "Q":
            commands.append(
                ("Q", float(tokens[i + 1]), float(tokens[i + 2]), float(tokens[i + 3]), float(tokens[i + 4]))
            )
            i += 5
        else:
            commands.append(("Z",))
            i += 1
    return commands


def bounds_of(contours):
    xs = [c[-2] for cmds in contours for c in cmds if c[0] != "Z"]
    ys = [c[-1] for cmds in contours for c in cmds if c[0] != "Z"]
    if not xs:
        return None
    return min(xs), max(xs), min(ys), max(ys)


def feed_pen(commands, pen, xmin, baseline_y, scale):
    """Canvas space is x-right/y-down with no baseline; font space is x-right/
    y-up with y=0 as the baseline. Maps the glyph's own drawn bbox to sit on
    the baseline (bbox bottom -> y=0) at TARGET_GLYPH_HEIGHT tall, left edge
    at SIDE_BEARING. Applied uniformly to on-curve and control points alike,
    which is safe - an affine transform commutes with quadratic Bezier
    evaluation."""

    def tx(x):
        return (x - xmin) * scale + SIDE_BEARING

    def ty(y):
        return (baseline_y - y) * scale

    started = False
    for c in commands:
        if c[0] == "M":
            pen.moveTo((tx(c[1]), ty(c[2])))
            started = True
        elif c[0] == "Q":
            pen.qCurveTo((tx(c[1]), ty(c[2])), (tx(c[3]), ty(c[4])))
        elif started:
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
        contours = [parse_path_commands(d) for d in entry.get("contours", [])]
        bounds = bounds_of(contours)
        if bounds:
            xmin, _xmax, ymin, ymax = bounds
            height = ymax - ymin
            scale = TARGET_GLYPH_HEIGHT / height if height > 0 else 1
            for commands in contours:
                feed_pen(commands, pen, xmin, ymax, scale)
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
