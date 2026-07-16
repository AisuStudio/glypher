#!/usr/bin/env python3
"""Compiles a fontane-document.json (Export tab -> Download JSON in the
Fontane web app) into a real .ttf font.

No UFO / ufo2ft involved: Fontane's exported SVG paths are already
quadratic (M/Q/Z, see src/lib/contour.ts), which is exactly what TrueType's
glyf table stores natively. So this builds the glyf table directly from the
parsed path data via fontTools' low-level FontBuilder + TTGlyphPen, instead
of round-tripping through a UFO and a cubic-curve compiler.

Usage:
    python3 build_ttf.py fontane-document.json output.ttf
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


def feed_pen(commands, pen, tx, ty):
    """Canvas space is x-right/y-down with no baseline; font space is x-right/
    y-up with y=0 as the baseline. tx/ty carry the actual mapping - either
    guide-based (guide_transform) or the bbox fallback (bbox_transform).
    Applied uniformly to on-curve and control points alike, which is safe -
    an affine transform commutes with quadratic Bezier evaluation."""
    started = False
    for c in commands:
        if c[0] == "M":
            pen.moveTo((tx(c[1]), ty(c[2])))
            started = True
        elif c[0] == "Q":
            pen.qCurveTo((tx(c[1]), ty(c[2])), (tx(c[3]), ty(c[4])))
        elif started:
            pen.closePath()


def guide_transform(entry, doc_metrics):
    """Grid View glyphs carry a real calibration: the document's shared
    baseline/ascender fractions plus this glyph's own draggable left/right
    bearings, both resolved against the cell's pixel size at draw time
    (cellWidth/cellHeight - captured once so a later window resize can't
    shift already-drawn glyphs relative to each other)."""
    if doc_metrics is None:
        return None
    left_bearing = entry.get("leftBearing")
    right_bearing = entry.get("rightBearing")
    cell_width = entry.get("cellWidth")
    cell_height = entry.get("cellHeight")
    if left_bearing is None or right_bearing is None or not cell_width or not cell_height:
        return None

    baseline_px = doc_metrics["baseline"] * cell_height
    ascender_px = doc_metrics["ascender"] * cell_height
    left_px = left_bearing * cell_width
    right_px = right_bearing * cell_width

    span = baseline_px - ascender_px
    scale = ASCENT / span if span > 0 else 1

    return (
        lambda x: (x - left_px) * scale,
        lambda y: (baseline_px - y) * scale,
        max(round((right_px - left_px) * scale), 1),
    )


def bbox_transform(contours):
    """Fallback for glyphs with no Grid View guide data (e.g. tagged via
    Write mode's lasso-select): rescale the glyph's own drawn bounding box to
    a fixed cap-height-ish target. No cross-glyph consistency, but nothing
    comes out microscopic, oversized, or upside-down either."""
    bounds = bounds_of(contours)
    if not bounds:
        return None
    xmin, xmax, ymin, ymax = bounds
    height = ymax - ymin
    scale = TARGET_GLYPH_HEIGHT / height if height > 0 else 1
    return (
        lambda x: (x - xmin) * scale + SIDE_BEARING,
        lambda y: (ymax - y) * scale,
        max(round((xmax - xmin) * scale + 2 * SIDE_BEARING), 1),
    )


def glyph_name_for(entry):
    # Match the naming convention the Glyphs import script also uses, so a
    # font built here and a font built via Glyphs.app agree on glyph names.
    if entry.get("kind") == "ligature" and entry.get("components"):
        return "_".join(entry["components"]) + ".liga"
    return entry["name"]


def build_font(doc, family_name="Fontane Sketch"):
    glyph_order = [".notdef"]
    cmap = {}
    glyphs = {}
    metrics = {}
    doc_metrics = doc.get("metrics")

    notdef_pen = TTGlyphPen(None)
    glyphs[".notdef"] = notdef_pen.glyph()
    metrics[".notdef"] = (DEFAULT_ADVANCE, 0)

    for entry in doc.get("glyphs", []):
        name = glyph_name_for(entry)
        pen = TTGlyphPen(None)
        contours = [parse_path_commands(d) for d in entry.get("contours", [])]
        transform = guide_transform(entry, doc_metrics) or bbox_transform(contours)

        advance, lsb = DEFAULT_ADVANCE, 0
        if transform:
            tx, ty, advance_width = transform
            for commands in contours:
                feed_pen(commands, pen, tx, ty)
        glyph = pen.glyph()
        glyphs[name] = glyph
        glyph_order.append(name)

        if glyph.numberOfContours:
            xs = [pt[0] for pt in glyph.coordinates]
            lsb = int(min(xs))
            advance = advance_width if transform else DEFAULT_ADVANCE
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
        print("Usage: python3 build_ttf.py <fontane-document.json> <output.ttf>")
        sys.exit(1)

    with open(sys.argv[1], "r", encoding="utf-8") as f:
        doc = json.load(f)

    fb = build_font(doc)
    fb.save(sys.argv[2])
    print(f"Wrote {sys.argv[2]} ({len(doc.get('glyphs', []))} glyphs)")


if __name__ == "__main__":
    main()
