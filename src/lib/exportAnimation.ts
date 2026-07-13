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
  const glyphCss: string[] = [];

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

    if (preset.glyphCss) glyphCss.push(preset.glyphCss({ glyphId: entry.glyph.id, index }));

    // Layout position lives on a plain SVG transform ATTRIBUTE on the outer
    // <g>; the preset's CSS only ever touches the inner .ls-glyph group. This
    // split matters — a CSS `transform` (even one only ever applied via an
    // @keyframes animation) overrides an element's `transform` presentation
    // attribute entirely, so animating the same group that carries the
    // layout translate/scale would silently discard the glyph's position the
    // moment the animation kicks in. `--ls-i` is the glyph's left-to-right
    // index as an inherited custom property — presets read it (via
    // `calc(var(--ls-i) * ...)`) to stagger either .ls-glyph or its
    // .ls-stroke children, whichever the effect actually animates. The
    // `data-ls-i` attribute mirrors the same index for presets (Rough) that
    // need to target one specific glyph occurrence directly instead of
    // computing a shared formula from it.
    return (
      `<g transform="translate(${round(entry.offsetX)} ${round(entry.offsetY)}) scale(${round(entry.scale)})">` +
      `<g class="ls-glyph" data-char="${escapeXml(entry.glyph.name)}" data-ls-i="${index}" style="--ls-i:${index}">${paths}</g>` +
      `</g>`
    );
  });

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${round(layout.width)} ${round(layout.height)}" ` +
    `width="${round(layout.width)}" height="${round(layout.height)}">${groups.join("")}</svg>`;

  return { svg, css: BASE_CSS + preset.css + glyphCss.join("") };
}

// The Copy-embed-code button's payload: a <style> tag plus the <svg> markup,
// pasteable directly into the middle of an existing page — unlike
// buildAnimationHtml below, this is a fragment, not a full document.
export function buildAnimationEmbed(svg: string, css: string): string {
  return `<style>\n${css}</style>\n${svg}`;
}

// Wraps the fragment into a standalone, double-clickable HTML file — for the
// Download button. The copy-embed-code path uses buildAnimationEmbed above
// instead, since a full <!doctype html> document isn't something you paste
// into the middle of an existing page.
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
