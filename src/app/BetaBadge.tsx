import styles from "./page.module.css";

// Ported from CNSL (app/page.tsx) — same concave "bowtie" ribbon shape,
// recolored/refonted to glypher's own tokens instead of CNSL's.
export default function BetaBadge() {
  return (
    <div className={styles.betaBadge} aria-hidden>
      <span className={styles.betaLabel}>We&rsquo;re still in</span>
      <div className={styles.betaRibbon}>
        <svg viewBox="0 0 132 56" width="90" height="38" style={{ position: "absolute", inset: 0 }}>
          <path
            d="M3 3 Q66 16 129 3 L129 53 Q66 40 3 53 Z"
            fill="none"
            stroke="var(--color-blueberry)"
            strokeWidth="1.5"
          />
        </svg>
        <span className={styles.betaText}>BETA</span>
      </div>
    </div>
  );
}
