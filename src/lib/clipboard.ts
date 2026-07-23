import type { StrokeKind, StrokePoint } from "./strokes";
import type { BezierAnchor } from "./vectorShapes";

// A module-level singleton, not React state and not persisted — a clipboard
// shouldn't survive a reload, same as the app's other in-memory-only
// pointer/editing refs. This is what lets Free's canvas AND every individual
// Grid cell (each its own component instance, with its own local selection —
// see GridCell.tsx) share one clipboard without prop-drilling through the
// whole cell grid.
//
// `source` on a copied stroke records where its points are expressed: "free"
// (Free-canvas-absolute px) or the exact pixel dimensions of the Grid cell it
// was copied from. Pasting into Free never rescales (see page.tsx); pasting
// into a Grid cell rescales relative to `source` (ratio scale for another
// cell, fitPointsToBox for content copied from Free — see geometry.ts).
export type ClipboardStrokeSource = "free" | { cellWidth: number; cellHeight: number };

export type ClipboardStroke = {
  points: StrokePoint[];
  kind?: StrokeKind;
  widthScale?: number;
  source: ClipboardStrokeSource;
};

// Vector shapes are Free-only (GridCell doesn't know about them at all), so
// there's no source tag to carry — only ever copied from and pasted into Free.
export type ClipboardShape = {
  anchors: BezierAnchor[];
  closed: boolean;
};

export type Clipboard = { strokes: ClipboardStroke[]; shapes: ClipboardShape[] } | null;

let clipboard: Clipboard = null;

export function setClipboard(next: Clipboard) {
  clipboard = next;
}

export function getClipboard(): Clipboard {
  return clipboard;
}
