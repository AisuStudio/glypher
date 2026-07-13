import { skeletonToPath, pathToSvgD, escapeXml } from "./contour";
import { saveFile } from "./saveFile";
import { layoutText, type TextLayout } from "./layoutText";
import { getPreset, BASE_CSS, type AnimationPresetId } from "./animationPresets";
import type { Glyph } from "./glyphs";
import type { Stroke } from "./strokes";
import type { Metrics } from "./metrics";

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

// Builds the embeddable fragment — a <style> body (BASE_CSS + the selected
// preset's own @keyframes) and an <svg> string laying out every glyph. This
// is the ONE function both the live preview (AnimatePanel.tsx) and the file
// export (buildAnimationHtml below) call, so they can never drift apart —
// same principle as outlineToPath being shared between canvas rendering and
// the other export paths.
export function buildAnimationSvg(layout: TextLayout, presetId: AnimationPresetId): { svg: string; css: string } {
  const preset = getPreset(presetId);
  let glyphIndex = 0;

  const groups = layout.entries.map((entry) => {
    if (entry.kind !== "glyph") return "";
    const index = glyphIndex++;

    const paths = entry.strokePointSets
      .map((points, strokeIndex) => {
        const d = pathToSvgD(skeletonToPath(points));
        const extraAttrs = preset.pathAttrs?.({ glyphId: entry.glyph.id, strokeIndex, points }) ?? "";
        return `<path class="ls-stroke" d="${d}" ${extraAttrs}/>`;
      })
      .join("");

    const style = preset.glyphStyle?.({ index }) ?? "";
    // Layout position lives on a plain SVG transform ATTRIBUTE on the outer
    // <g>; the preset's CSS only ever touches the inner .ls-glyph group. This
    // split matters — a CSS `transform` (even one only ever applied via an
    // @keyframes animation) overrides an element's `transform` presentation
    // attribute entirely, so animating the same group that carries the
    // layout translate/scale would silently discard the glyph's position the
    // moment the animation kicks in.
    return (
      `<g transform="translate(${round(entry.offsetX)} ${round(entry.offsetY)}) scale(${round(entry.scale)})">` +
      `<g class="ls-glyph" data-char="${escapeXml(entry.glyph.name)}" style="${style}">${paths}</g>` +
      `</g>`
    );
  });

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${round(layout.width)} ${round(layout.height)}" ` +
    `width="${round(layout.width)}" height="${round(layout.height)}">${groups.join("")}</svg>`;

  return { svg, css: BASE_CSS + preset.css };
}

// Wraps the fragment into a standalone, double-clickable HTML file — for the
// Download button. The copy-embed-code path (Phase 3) uses buildAnimationSvg's
// {svg, css} fragment directly instead, since a full <!doctype html> document
// isn't something you paste into the middle of an existing page.
export function buildAnimationHtml(
  text: string,
  glyphs: Glyph[],
  strokes: Stroke[],
  metrics: Metrics,
  presetId: AnimationPresetId
): string {
  const layout = layoutText(text, glyphs, strokes, metrics);
  const { svg, css } = buildAnimationSvg(layout, presetId);
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
body { margin: 0; padding: 2rem; background: #eae8e0; }
${css}
</style>
</head>
<body>
${svg}
</body>
</html>
`;
}

export function downloadAnimationHtml(
  text: string,
  glyphs: Glyph[],
  strokes: Stroke[],
  metrics: Metrics,
  presetId: AnimationPresetId,
  fileName = "letterspace-animation.html"
) {
  const html = buildAnimationHtml(text, glyphs, strokes, metrics, presetId);
  const blob = new Blob([html], { type: "text/html" });
  saveFile(blob, {
    suggestedName: fileName,
    mimeType: "text/html",
    extension: "html",
    description: "letter.space animated HTML",
  });
}
