import { seededRandom, randomRange } from "./random";

// Registry of Animate-mode presets. Each preset only owns its OWN CSS (a
// @keyframes block plus whatever rule turns it on) and an optional per-path
// style hook — the shared setup (colors, base stroke look, the
// transform-box/transform-origin fix below) lives once in BASE_CSS so it
// isn't duplicated per preset.
export type AnimationPresetId = "pulse" | "thinBold" | "dotted";

export type PathStyleContext = { glyphId: string; strokeIndex: number; points: [number, number][] };

export type AnimationPreset = {
  id: AnimationPresetId;
  label: string;
  // CSS text (a @keyframes block + the rule(s) that apply it) — NOT
  // including BASE_CSS, callers concatenate BASE_CSS + preset.css. Any rule
  // that wants a left-to-right stagger reads the `--ls-i` custom property
  // (see BASE_CSS below) via e.g. `animation-delay: calc(var(--ls-i) * .08s)`.
  css: string;
  // Extra attributes (as a raw string, e.g. `stroke-dasharray="4 2"`) for one
  // <path class="ls-stroke"> — for values that depend on the actual stroke
  // geometry (path length) or need per-path randomness, neither of which a
  // CSS formula alone can express.
  pathAttrs?: (ctx: PathStyleContext) => string;
};

// SVG elements have no bbox-relative transform-origin by default — without
// this, "transform-origin: center" would center on the SVG document's own
// origin, not the glyph's own ink, and every per-letter effect would look
// wrong (e.g. Pulse growing from the top-left corner of the whole word
// instead of from each letter's own middle). Every preset that transforms
// .ls-glyph relies on this being present.
//
// `--ls-i` is set once per glyph (its left-to-right index, see
// exportAnimation.ts) on the .ls-glyph group and inherits down to its
// .ls-stroke children — custom properties inherit even though the
// `animation`/`animation-delay` properties that read them do not. This lets
// a preset stagger either the whole glyph (Pulse, animating .ls-glyph) or
// its individual strokes (Thin<->Bold, animating .ls-stroke) with the same
// mechanism.
export const BASE_CSS = `
.ls-glyph {
  transform-box: fill-box;
  transform-origin: center;
}
.ls-stroke {
  fill: none;
  stroke: #1f1934;
  stroke-width: 6px;
  stroke-linecap: round;
  stroke-linejoin: round;
}
`;

const PULSE_STAGGER = 0.08; // seconds per glyph index

const pulsePreset: AnimationPreset = {
  id: "pulse",
  label: "Pulse",
  css: `
@keyframes ls-pulse {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.12); }
}
.ls-glyph {
  animation: ls-pulse 1.4s ease-in-out infinite;
  animation-delay: calc(var(--ls-i) * ${PULSE_STAGGER}s);
}
`,
};

const THINBOLD_STAGGER = 0.08;

const thinBoldPreset: AnimationPreset = {
  id: "thinBold",
  label: "Thin↔Bold",
  css: `
@keyframes ls-thinbold {
  0%, 100% { stroke-width: 3px; }
  50% { stroke-width: 14px; }
}
.ls-stroke {
  animation: ls-thinbold 1.6s ease-in-out infinite;
  animation-delay: calc(var(--ls-i) * ${THINBOLD_STAGGER}s);
}
`,
};

function polylineLength(points: [number, number][]): number {
  let len = 0;
  for (let i = 1; i < points.length; i++) {
    const [x0, y0] = points[i - 1];
    const [x1, y1] = points[i];
    len += Math.hypot(x1 - x0, y1 - y0);
  }
  return len;
}

const dottedPreset: AnimationPreset = {
  id: "dotted",
  label: "Dotted",
  css: `
@keyframes ls-dash {
  to { stroke-dashoffset: var(--ls-dash-shift); }
}
.ls-stroke {
  animation-name: ls-dash;
  animation-timing-function: linear;
  animation-iteration-count: infinite;
}
`,
  // Seeded by glyph id + stroke index — deliberately NOT by occurrence in the
  // typed text. layoutText resolves every occurrence of a letter to the same
  // tagged Glyph object, so this makes repeated letters (the two "l"s in
  // "hello") share the same dash texture, since it reads as a property of
  // the letterform rather than of where it happens to appear.
  pathAttrs: ({ glyphId, strokeIndex, points }) => {
    const rng = seededRandom(`${glyphId}:${strokeIndex}`);
    const len = Math.max(polylineLength(points), 1);
    const dash = randomRange(rng, len * 0.05, len * 0.15);
    const gap = randomRange(rng, len * 0.05, len * 0.12);
    const duration = randomRange(rng, 2, 4);
    const shift = -(dash + gap) * 4; // a few dash cycles of travel for a marching-dots reveal
    return (
      `stroke-dasharray="${dash.toFixed(2)} ${gap.toFixed(2)}" ` +
      `style="animation-duration:${duration.toFixed(2)}s;--ls-dash-shift:${shift.toFixed(2)}"`
    );
  },
};

export const ANIMATION_PRESETS: AnimationPreset[] = [pulsePreset, thinBoldPreset, dottedPreset];
export const DEFAULT_PRESET_ID: AnimationPresetId = ANIMATION_PRESETS[0].id;

export function getPreset(id: AnimationPresetId): AnimationPreset {
  return ANIMATION_PRESETS.find((p) => p.id === id) ?? ANIMATION_PRESETS[0];
}
