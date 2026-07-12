#MenuTitle: Import from Glypher
# -*- coding: utf-8 -*-
"""Imports a glypher-document.json (exported from the Glypher web app) into
the current font: creates/updates glyphs, sets Unicode for base characters,
and builds each glyph's outline from the exported SVG contour paths."""

import json
import re

from GlyphsApp import Glyphs, GSGlyph, GSPath, GSNode, Message, GetOpenFile, LINE, OFFCURVE, QCURVE

# Canvas pixels -> font units. Glypher's canvas has no notion of your font's
# metrics, so this is a starting guess, not a calibrated mapping. Re-scale
# and reposition the first import in Glyphs, then adjust SCALE to match.
SCALE = 1.0
FLIP_Y = True  # canvas y grows downward, font design space grows upward

TOKEN_RE = re.compile(r"[MQZ]|-?\d+(?:\.\d+)?")


def transform(x, y):
    if FLIP_Y:
        y = -y
    return (x * SCALE, y * SCALE)


def parse_contour(d):
    """Turns one 'M x y Q cx cy x y Q ... Z' path string (see
    src/lib/contour.ts in the web app) into a list of GSNode."""
    tokens = TOKEN_RE.findall(d)
    nodes = []
    i = 0
    while i < len(tokens):
        tok = tokens[i]
        if tok == "M":
            x, y = transform(float(tokens[i + 1]), float(tokens[i + 2]))
            nodes.append(GSNode((x, y), LINE))
            i += 3
        elif tok == "Q":
            cx, cy = transform(float(tokens[i + 1]), float(tokens[i + 2]))
            x, y = transform(float(tokens[i + 3]), float(tokens[i + 4]))
            nodes.append(GSNode((cx, cy), OFFCURVE))
            nodes.append(GSNode((x, y), QCURVE))
            i += 5
        else:
            i += 1
    return nodes


def glyphs_name_for(entry):
    # Glyphs auto-recognizes underscore-joined names as ligatures; the .liga
    # suffix forces the `liga` feature instead of `dlig`. Building the name
    # from `components` (not trusting the free-typed name) guarantees that.
    if entry.get("kind") == "ligature" and entry.get("components"):
        return "_".join(entry["components"]) + ".liga"
    return entry["name"]


def build_layer(entry, font, master_id):
    name = glyphs_name_for(entry)
    layer = font.glyphs[name].layers[master_id]
    paths = []
    for d in entry.get("contours", []):
        nodes = parse_contour(d)
        if len(nodes) < 2:
            continue
        path = GSPath()
        path.nodes = nodes
        path.closed = True
        paths.append(path)
    layer.paths = paths
    layer.correctPathDirection()


def main():
    font = Glyphs.font
    if font is None:
        Message("Open a font in Glyphs first.", title="Glypher Import")
        return

    filepath = GetOpenFile(message="Choose glypher-document.json", filetypes=["json"])
    if not filepath:
        return

    with open(filepath, "r", encoding="utf-8") as f:
        doc = json.load(f)

    master_id = font.masters[0].id
    imported = []

    font.disableUpdateInterface()
    try:
        for entry in doc.get("glyphs", []):
            name = glyphs_name_for(entry)
            glyph = font.glyphs[name]
            if glyph is None:
                glyph = GSGlyph(name)
                font.glyphs.append(glyph)

            if entry.get("kind") == "base" and entry.get("unicode"):
                glyph.unicode = entry["unicode"].replace("U+", "")

            glyph.beginUndo()
            try:
                build_layer(entry, font, master_id)
            finally:
                glyph.endUndo()

            imported.append(name)
    finally:
        font.enableUpdateInterface()

    font.updateFeatures()

    alt_names = [g["name"] for g in doc.get("glyphs", []) if g.get("kind") == "alternate"]
    note = ""
    if alt_names:
        note = "\n\nAlternates (%s) imported as glyphs but need manual feature code (calt/ssNN) — Glyphs doesn't auto-wire .alt names." % ", ".join(alt_names)

    Message(
        "Imported %d glyph(s): %s%s" % (len(imported), ", ".join(imported), note),
        title="Glypher Import",
    )


main()
