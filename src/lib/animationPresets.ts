// Registry of Animate-mode presets. Each preset only owns its OWN CSS (a
// @keyframes block plus whatever rule turns it on) and small per-glyph/
// per-path style hooks — the shared setup (colors, base stroke look, the
// transform-box/transform-origin fix below) lives once in BASE_CSS so it
// isn't duplicated per preset.
export type AnimationPresetId = "pulse";

export type GlyphStyleContext = { index: number };
export type PathStyleContext = { glyphId: string; strokeIndex: number; points: [number, number][] };

export type AnimationPreset = {
  id: AnimationPresetId;
  label: string;
  // CSS text (a @keyframes block + the rule(s) that apply it) — NOT
  // including BASE_CSS, callers concatenate BASE_CSS + preset.css.
  css: string;
  // Inline style for the <g class="ls-glyph"> wrapping one glyph's paths —
  // e.g. a per-index animation-delay for a left-to-right stagger.
  glyphStyle?: (ctx: GlyphStyleContext) => string;
  // Extra attributes (as a raw string, e.g. `stroke-dasharray="4 2"`) for one
  // <path class="ls-stroke">.
  pathAttrs?: (ctx: PathStyleContext) => string;
};

// SVG elements have no bbox-relative transform-origin by default — without
// this, "transform-origin: center" would center on the SVG document's own
// origin, not the glyph's own ink, and every per-letter effect would look
// wrong (e.g. Pulse growing from the top-left corner of the whole word
// instead of from each letter's own middle). Every preset that transforms
// .ls-glyph relies on this being present.
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
}
`,
  glyphStyle: ({ index }) => `animation-delay:${(index * PULSE_STAGGER).toFixed(2)}s`,
};

export const ANIMATION_PRESETS: AnimationPreset[] = [pulsePreset];
export const DEFAULT_PRESET_ID: AnimationPresetId = ANIMATION_PRESETS[0].id;

export function getPreset(id: AnimationPresetId): AnimationPreset {
  return ANIMATION_PRESETS.find((p) => p.id === id) ?? ANIMATION_PRESETS[0];
}
