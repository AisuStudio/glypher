// Interner Pricing-Arbeitsstand — nicht in Sitemap, nicht verlinkt, noindex.
// Erreichbar nur über die direkte URL (siehe robots.ts: kein Disallow-Eintrag,
// um den Pfad nicht zu verraten — Sicherheit über Nichtverlinkung + Meta-Tag).
export const metadata = { robots: { index: false, follow: false } };

const wrap: React.CSSProperties = {
  minHeight: "100vh",
  background: "var(--color-bg)",
  color: "var(--color-text)",
  fontFamily: "var(--font-sans)",
  padding: "var(--sp-3xl) var(--gutter)",
  display: "flex",
  justifyContent: "center",
};

const col: React.CSSProperties = {
  maxWidth: 760,
  width: "100%",
};

const h1: React.CSSProperties = {
  fontSize: 28,
  marginBottom: 4,
};

const sub: React.CSSProperties = {
  opacity: 0.6,
  marginBottom: "var(--sp-2xl)",
  fontSize: 14,
  fontFamily: "var(--font-mono)",
};

const h2: React.CSSProperties = {
  fontSize: 18,
  marginTop: "var(--sp-2xl)",
  marginBottom: "var(--sp-md)",
  paddingBottom: "var(--sp-xs)",
  borderBottom: "1px solid rgba(31,25,52,0.15)",
};

const tierRow: React.CSSProperties = {
  display: "flex",
  gap: "var(--sp-md)",
  flexWrap: "wrap",
  marginBottom: "var(--sp-md)",
};

const tierCard: React.CSSProperties = {
  flex: "1 1 200px",
  background: "var(--color-surface)",
  borderRadius: 8,
  padding: "var(--sp-lg)",
};

const tierName: React.CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: 13,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  opacity: 0.6,
  marginBottom: "var(--sp-xs)",
};

const tierPrice: React.CSSProperties = {
  fontSize: 22,
  marginBottom: "var(--sp-sm)",
};

const tierDesc: React.CSSProperties = {
  fontSize: 14,
  lineHeight: 1.5,
};

const p: React.CSSProperties = {
  fontSize: 14,
  lineHeight: 1.6,
  marginBottom: "var(--sp-sm)",
};

const ul: React.CSSProperties = {
  fontSize: 14,
  lineHeight: 1.6,
  paddingLeft: "1.2em",
  marginBottom: "var(--sp-sm)",
};

const li: React.CSSProperties = {
  marginBottom: "var(--sp-xs)",
};

const strong: React.CSSProperties = {
  fontWeight: 700,
};

const rejectedBox: React.CSSProperties = {
  background: "rgba(31,25,52,0.04)",
  borderLeft: "3px solid var(--color-muted)",
  padding: "var(--sp-sm) var(--sp-md)",
  marginBottom: "var(--sp-sm)",
  fontSize: 14,
  lineHeight: 1.5,
};

const rejectedTitle: React.CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontWeight: 700,
  marginRight: "var(--sp-xs)",
};

const openBox: React.CSSProperties = {
  background: "rgba(216,255,1,0.15)",
  borderRadius: 6,
  padding: "var(--sp-sm) var(--sp-md)",
  marginBottom: "var(--sp-sm)",
  fontSize: 14,
  lineHeight: 1.5,
};

const openTitle: React.CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontWeight: 700,
  marginRight: "var(--sp-xs)",
};

const footer: React.CSSProperties = {
  marginTop: "var(--sp-2xl)",
  paddingTop: "var(--sp-md)",
  borderTop: "1px solid rgba(31,25,52,0.15)",
  fontSize: 12,
  fontFamily: "var(--font-mono)",
  opacity: 0.5,
  lineHeight: 1.6,
};

export default function PricingReviewPage() {
  return (
    <div style={wrap}>
      <div style={col}>
        <h1 style={h1}>Fontane Pricing</h1>
        <p style={sub}>Entscheidungsstand &amp; Kontext — Juli 2026 — interner Arbeitsstand, nicht öffentlich</p>

        <h2 style={h2}>Finale Preisstruktur (v3, Arbeitsstand)</h2>
        <div style={tierRow}>
          <div style={tierCard}>
            <div style={tierName}>Free</div>
            <div style={tierPrice}>0 €</div>
            <div style={tierDesc}>
              Komplette Werkbank — zeichnen (Pencil/Wacom/Maus), unbegrenzt FFF-Projekte speichern, alle
              Character-Sets anlegen, Live-Preview (&quot;Tippe deinen Namen in deiner Handschrift&quot;).
              Kein Font-Download.
            </div>
          </div>
          <div style={tierCard}>
            <div style={tierName}>Font-Export</div>
            <div style={tierPrice}>9,99 € <span style={{ fontSize: 12, opacity: 0.6 }}>pro Fontfamilie</span></div>
            <div style={tierDesc}>
              Einmalzahlung, brutto. Alle Character-Sets, OTF + TTF, kommerzielle Nutzung inklusive,
              Re-Export/Korrekturen desselben Fonts frei.
            </div>
          </div>
          <div style={tierCard}>
            <div style={tierName}>Studio</div>
            <div style={tierPrice}>49 € <span style={{ fontSize: 12, opacity: 0.6 }}>Launch (Liste 59 €)</span></div>
            <div style={tierDesc}>
              Einmalzahlung. Unbegrenzte Exporte + Glyphs-Bridge + Skeleton-SVG-Export + Illustrator
              Ex-/Import (SVG) + Local-only-Modus (FFF lokal, ohne Cloud).
            </div>
          </div>
        </div>

        <h2 style={h2}>Kern-Rationale</h2>
        <ul style={ul}>
          <li style={li}>
            <span style={strong}>Paywall-Moment:</span> Bezahlt wird am emotionalen Peak — User zeichnet, sieht
            Namens-Preview, dann &quot;Deinen Font freischalten — 9,99 €&quot;. Alles davor ist frei. Nichts
            limitieren, was vor diesem Moment liegt.
          </li>
          <li style={li}>
            <span style={strong}>Pay-per-Font statt Character-Set-Gating:</span> &quot;Erstellen ist gratis, dein
            fertiger Font kostet 9,99 €&quot; versteht jeder sofort. Löst die Free-Tier-Abgrenzungsdiskussion
            komplett auf.
          </li>
          <li style={li}>
            <span style={strong}>KI-Lage:</span> Generative AI macht generische Fonts wertlos → Fontane verkauft
            Authentizität (die eigene Hand), nicht Font-Menge. Pay-per-Result passt zum Credit-Denken der KI-Ära.
          </li>
          <li style={li}>
            <span style={strong}>Abo-Müdigkeit:</span> Calligraphr ~8 €/Monat — Einmalzahlung ist 2026
            Kaufargument, kein Nachteil.
          </li>
          <li style={li}>
            <span style={strong}>Preisdecke Studio:</span> Bewusst unter Glyphs Mini (~50 €), auf
            Fontself-Niveau (49 €) aber ohne Adobe-Zwang. Positionierung: günstigerer, moderner Herausforderer.
            67 € wurde diskutiert und wegen Wahrnehmung (&quot;teurer als echter Font-Editor&quot;) verworfen —
            liegt aber als Alternative noch im Raum.
          </li>
          <li style={li}>
            <span style={strong}>Anker-Effekt:</span> Studio (49) macht 9,99 optisch billig; Break-even Studio
            bei 5 Fonts → Profis sortieren sich selbst.
          </li>
        </ul>

        <h2 style={h2}>Verworfen (mit Begründung — nicht wieder vorschlagen)</h2>
        <div style={rejectedBox}>
          <span style={rejectedTitle}>9,99 € für alles inkl. Glyphs-Bridge (v1):</span>
          verschenkt Zahlungsbereitschaft der Glyphs-Zielgruppe (300-€-Lizenz-Besitzer).
        </div>
        <div style={rejectedBox}>
          <span style={rejectedTitle}>4,99 € Light-Tier (3 Character-Sets):</span>
          kannibalisiert 9,99, Paddle-Gebühren fressen Marge, Entscheidungslast.
        </div>
        <div style={rejectedBox}>
          <span style={rejectedTitle}>99 ct pro Workfile-Speicherung:</span>
          bestraft gewünschtes Verhalten, Mikrotransaktionen unter 1 € gehen an Gebühren verloren.
        </div>
        <div style={rejectedBox}>
          <span style={rejectedTitle}>Local-FFF-Export als Paywall:</span>
          Datenportabilität gaten = böses Blut. Stattdessen Local-only-Modus als Studio-Pro-Privacy-Feature.
        </div>

        <h2 style={h2}>Offene Optionen (nicht auf Pricing-Page, als Mechaniken geplant)</h2>
        <div style={openBox}>
          <span style={openTitle}>Slot-Upsell:</span>
          +2 Fonts für 10 €, nur post-purchase (ab Okt., nach Conversion-Daten).
        </div>
        <div style={openBox}>
          <span style={openTitle}>Gift Edition 14,99 €:</span>
          Gutschein + PDF-Karte, &quot;Verschenke eine Handschrift&quot;, Q4/Weihnachten.
        </div>
        <div style={openBox}>
          <span style={openTitle}>Font-Trio 15 €:</span>
          umstritten — wenn, dann nur zeitlich begrenzte Aktion, nie Dauer-Tier (Kannibalisierung).
        </div>
        <div style={openBox}>
          <span style={openTitle}>Early-Bird Studio:</span>
          49 € für erste 100 Käufer, dann 59 € regulär.
        </div>

        <h2 style={h2}>Später / nicht bindend</h2>
        <p style={p}>
          <span style={strong}>Resell-Marketplace:</span> Creator verkaufen Fonts, ~80/20 Rev-Share zugunsten
          Creator. Pfad: 1) Public Gallery (zeigen/teilen) → 2) Nachfrage-Signal abwarten (&quot;Kann ich den
          kaufen?&quot;) → 3) Marketplace frühestens 2027. Rechtlich anderes Kaliber (Lizenzen, Auszahlungen,
          Kleinunternehmerregelung fällt evtl.).
        </p>

        <h2 style={h2}>Rahmenbedingungen</h2>
        <ul style={ul}>
          <li style={li}>Payment: Paddle als Merchant of Record (VAT, Widerruf, Gift-Codes).</li>
          <li style={li}>Kleinunternehmerregelung § 19 UStG → Bruttopreise, kein USt-Ausweis.</li>
          <li style={li}>Supabase EU (Frankfurt), Auth v1 = Magic Link.</li>
          <li style={li}>
            &quot;Unlimited&quot; in Studio-AGB auf Exporte beziehen; Cloud-Speicher mit großzügigem definiertem
            Limit (~50 Projekte) deckeln.
          </li>
          <li style={li}>Timeline: Soft Launch Sept., Hard Launch Okt.–Dez. (Weihnachten).</li>
          <li style={li}>Go/No-Go: ~100 zahlende Käufe bis 31.12.</li>
        </ul>

        <div style={footer}>
          Interne Review-Seite — nicht in Sitemap, kein Disallow-Eintrag in robots.txt (würde den Pfad
          verraten), nirgends verlinkt, noindex/nofollow via Metadata. Erreichbar nur über direkten Aufruf
          dieser URL.
        </div>
      </div>
    </div>
  );
}
