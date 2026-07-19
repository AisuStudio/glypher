export const metadata = { title: "Imprint & Privacy — Fontane.Studio" };

export default function LegalPage() {
  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#eae8e0",
        color: "#1f1934",
        fontFamily: "monospace",
        padding: "48px 24px",
        display: "flex",
        justifyContent: "center",
      }}
    >
      <div style={{ maxWidth: 720, width: "100%" }}>
        <h1 style={{ fontSize: 28, marginBottom: 32 }}>Imprint &amp; Privacy</h1>

        <h2 style={{ fontSize: 18, marginBottom: 12 }}>Imprint</h2>
        <p style={{ marginBottom: 40, fontSize: 14, lineHeight: 1.7 }}>
          Aisu.Studio
          <br />
          Dominik Heilig
          <br />
          c/o Working
          <br />
          Manteuffelstraße 58
          <br />
          10999 Berlin
        </p>

        <h2 style={{ fontSize: 18, marginBottom: 12 }}>Privacy</h2>

        <h3 style={{ fontSize: 15, margin: "24px 0 8px" }}>What we don&apos;t do</h3>
        <p style={{ marginBottom: 16, fontSize: 14, lineHeight: 1.7 }}>
          No cookies. No third-party trackers, ads, or analytics scripts — no Google Analytics, no Meta Pixel,
          nothing like that. No persistent identifier is ever written to your device for tracking purposes.
        </p>

        <h3 style={{ fontSize: 15, margin: "24px 0 8px" }}>Mini analytics</h3>
        <p style={{ marginBottom: 8, fontSize: 14, lineHeight: 1.7 }}>
          Visiting the live site (fontane.studio) briefly logs three kinds of event, none of which can identify
          you personally:
        </p>
        <ul style={{ marginBottom: 16, fontSize: 14, lineHeight: 1.7, paddingLeft: 20 }}>
          <li>
            <strong>Page visits</strong> — counted via a one-way hash of your IP address, your browser&apos;s
            user-agent, and the calendar date, combined with a private salt. That hash changes every day and
            can&apos;t be reversed back into your IP — it only lets us approximate how many different people
            visit per day, without storing your actual IP anywhere. We also record the referring site&apos;s
            hostname only (e.g. &quot;google.com&quot;), never a full URL or query parameters.
          </li>
          <li>
            <strong>Time on site</strong> — how many seconds a visit lasted, with no identifier attached at all.
          </li>
          <li>
            <strong>Font exports</strong> — which file format you exported (e.g. &quot;otf&quot;), with no
            identifier attached.
          </li>
        </ul>
        <p style={{ marginBottom: 16, fontSize: 14, lineHeight: 1.7 }}>
          None of this fires from local development or preview deployments — only the real production site. You
          can opt out for a given visit by adding <code>?notrack</code> to the URL (e.g.{" "}
          <code>fontane.studio/?notrack</code>) — every beacon is skipped client-side, nothing is even sent. This
          is processed under legitimate interest (GDPR Art. 6(1)(f)) — understanding rough usage without
          identifying anyone.
        </p>

        <h3 style={{ fontSize: 15, margin: "24px 0 8px" }}>Your drawings and fonts</h3>
        <p style={{ marginBottom: 16, fontSize: 14, lineHeight: 1.7 }}>
          Everything you draw and tag — strokes, glyphs, metrics, settings — is saved only in your own
          browser&apos;s local storage. We never see it, and it&apos;s never sent to our servers unless you
          explicitly choose to:
        </p>
        <ul style={{ marginBottom: 16, fontSize: 14, lineHeight: 1.7, paddingLeft: 20 }}>
          <li>
            <strong>Export</strong> a font, JSON, skeleton SVG, or FFF project file — generated entirely in your
            browser and offered to you as a download; nothing is uploaded.
          </li>
          <li>
            <strong>Publish</strong> a font to the Marketplace — this uploads the compiled font file plus the
            name you chose to our storage, along with a small metadata record (font name, glyph count, publish
            date, download count). Once published, it&apos;s public — anyone with the link, or browsing the
            Marketplace, can view and download it. There&apos;s no account system, so a published font
            currently can&apos;t be edited, renamed, or taken down by request through the app — double-check
            what you&apos;re publishing beforehand.
          </li>
        </ul>

        <h3 style={{ fontSize: 15, margin: "24px 0 8px" }}>Infrastructure</h3>
        <p style={{ marginBottom: 16, fontSize: 14, lineHeight: 1.7 }}>
          The site is hosted on Vercel (application and edge network), with Supabase as our database and file
          storage provider for published fonts and the anonymous analytics described above. We don&apos;t run
          any servers of our own.
        </p>

        <h3 style={{ fontSize: 15, margin: "24px 0 8px" }}>About this page</h3>
        <p style={{ marginBottom: 16, fontSize: 14, lineHeight: 1.7, opacity: 0.75 }}>
          This describes what the site actually, technically does today, kept in sync as that changes — not a
          substitute for formal legal advice. If you need a legally certified policy for your own use case,
          have it reviewed by a lawyer.
        </p>
      </div>
    </div>
  );
}
