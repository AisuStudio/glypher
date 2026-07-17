"use client";

import { useMemo, useState } from "react";
import styles from "./page.module.css";
import { layoutText } from "@/lib/layoutText";
import { buildAnimationSvg, buildAnimationEmbed, downloadAnimationHtml } from "@/lib/exportAnimation";
import { ANIMATION_PRESETS, type AnimationPresetId } from "@/lib/animationPresets";
import { trackExport } from "@/lib/analytics";
import type { Glyph } from "@/lib/glyphs";
import type { Stroke } from "@/lib/strokes";
import type { Metrics } from "@/lib/metrics";

type Props = {
  glyphs: Glyph[];
  strokes: Stroke[];
  metrics: Metrics;
  text: string;
  onTextChange: (text: string) => void;
  presetId: AnimationPresetId;
  onPresetChange: (id: AnimationPresetId) => void;
};

export default function AnimatePanel({
  glyphs,
  strokes,
  metrics,
  text,
  onTextChange,
  presetId,
  onPresetChange,
}: Props) {
  // layoutText/buildAnimationSvg are the exact same functions
  // exportAnimation.ts's downloadAnimationHtml uses, so this live preview and
  // the downloaded file can never drift apart.
  const layout = useMemo(() => layoutText(text, glyphs, strokes, metrics), [text, glyphs, strokes, metrics]);
  const { svg, css } = useMemo(() => buildAnimationSvg(layout, presetId), [layout, presetId]);
  const hasGlyphs = layout.entries.some((e) => e.kind === "glyph");
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");

  function handleCopy() {
    navigator.clipboard
      .writeText(buildAnimationEmbed(svg, css))
      .then(() => setCopyState("copied"))
      .catch(() => setCopyState("failed"));
    setTimeout(() => setCopyState("idle"), 1500);
  }

  return (
    <div className={styles.animatePanel}>
      <div className={styles.toolbar}>
        <input
          type="text"
          className={styles.nameInput}
          placeholder="type a word (uses your tagged glyphs)"
          value={text}
          onChange={(e) => onTextChange(e.target.value)}
        />

        <div className={styles.modeToggle} role="radiogroup" aria-label="Animation preset">
          {ANIMATION_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              role="radio"
              aria-checked={presetId === preset.id}
              className={`${styles.modeBtn} ${presetId === preset.id ? styles.modeBtnActive : ""}`}
              onClick={() => onPresetChange(preset.id)}
            >
              {preset.label}
            </button>
          ))}
        </div>

        <button
          type="button"
          className={`${styles.clearBtn} ${copyState === "failed" ? styles.dangerBtn : ""}`}
          onClick={handleCopy}
          disabled={!hasGlyphs}
        >
          {copyState === "copied" ? "Copied!" : copyState === "failed" ? "Copy failed" : "Copy embed code"}
        </button>

        <button
          type="button"
          className={styles.clearBtn}
          onClick={() => {
            trackExport("animation-html");
            downloadAnimationHtml(text, glyphs, strokes, metrics, presetId);
          }}
          disabled={!hasGlyphs}
        >
          Download HTML
        </button>
      </div>

      {layout.missing.length > 0 && (
        <div className={styles.animateWarning}>missing glyphs: {layout.missing.join(" ")}</div>
      )}

      <div className={styles.animatePreview}>
        <style>{css}</style>
        <div dangerouslySetInnerHTML={{ __html: svg }} />
      </div>
    </div>
  );
}
