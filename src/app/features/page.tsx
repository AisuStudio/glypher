import type { Metadata } from "next";
import MarketplaceNav from "../marketplace/MarketplaceNav";

const description =
  "Every feature of Fontane.Studio: pressure-sensitive hand-lettering capture, a Bezier vector pen tool, Grid and Free drawing, ligatures and alternates, copy/paste across views, and instant OTF export — all running in the browser, free.";

export const metadata: Metadata = {
  title: "Features — Fontane.Studio",
  description,
  alternates: { canonical: "/features" },
  openGraph: {
    title: "Features — Fontane.Studio",
    description,
    url: "https://fontane.studio/features",
    siteName: "Fontane.Studio",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Features — Fontane.Studio",
    description,
  },
};

// Richer than the root layout's brief 3-item featureList (see layout.tsx) —
// this is the page AI answer engines (ChatGPT, Perplexity, Google AI
// Overviews — see robots.ts's explicit allow-list for their crawlers) should
// land on when asked "what can Fontane.Studio do", so every real feature
// gets its own atomic, quotable sentence rather than being folded into prose.
const jsonLd = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "Fontane.Studio",
  url: "https://fontane.studio",
  applicationCategory: "DesignApplication",
  operatingSystem: "Any (runs in the browser)",
  offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
  featureList: [
    "Pressure-sensitive freehand drawing with Apple Pencil, Wacom, or a mouse",
    "Grid View with per-character guides (ascender, x-height, baseline, descender) and adjustable side bearings",
    "Vector pen tool with true Bezier anchor points and handles, for precise shapes and letter counters",
    "Boolean hole/counter cutting — vector shapes punch through overlapping strokes to form counters like in 'o' or 'e'",
    "Anchor and Nudge tools to reshape already-drawn strokes point by point",
    "Character set library: Latin Basic, Central European accents, punctuation, and currency/math symbols",
    "Ligatures and stylistic alternates, tagged and exported as real OpenType substitution glyphs",
    "Copy and paste strokes and vector shapes within Free Draw, within Grid, and between the two",
    "Move, rotate, and scale tools for reshaping and repositioning drawn letters",
    "Editor view to type live preview text using your own tagged glyphs",
    "Animate mode: CSS-driven text animations exportable as a self-contained HTML embed",
    "Instant OTF font export, generated entirely client-side, no upload required",
    "Skeleton SVG export for manual refinement in Glyphs.app or other type tools",
    "FFF project files to save and resume a font in progress",
    "Glyphs.app import script for glyph-level fine-tuning by professional type designers",
    "Marketplace to publish, browse, and download fonts made by other users",
    "Provenance verification gate that checks a font was actually hand-drawn before it can be published",
    "No cookies, no third-party trackers, GDPR-safe anonymous analytics",
    "Installable as a Progressive Web App, works entirely in the browser",
  ],
};

type Feature = { name: string; description: string };
type Section = { title: string; features: Feature[] };

const SECTIONS: Section[] = [
  {
    title: "Draw & capture",
    features: [
      {
        name: "Free Draw",
        description:
          "A freeform canvas for sketching letters exactly as you would on paper, with real pressure-sensitive stroke width from Apple Pencil, Wacom, or a mouse.",
      },
      {
        name: "Grid View",
        description:
          "One cell per character, with ascender, x-height, baseline, and descender guides plus draggable side bearings — the systematic way to draw a full alphabet.",
      },
      {
        name: "Mono line & Dynamic strokes",
        description: "Switch between constant-width ink and pressure-responsive thickness, with live size/thinning/smoothing/streamline controls.",
      },
    ],
  },
  {
    title: "Precision vector tools",
    features: [
      {
        name: "Vector pen tool",
        description:
          "A true Bezier pen tool — click for corner points, click-drag for smooth curve points, click an anchor to delete it, click a curve segment to insert one.",
      },
      {
        name: "Punch-out counters",
        description:
          "A closed vector shape defaults to cutting a hole through whatever it overlaps in the same glyph — the standard way to draw the counter of an 'o', 'e', or 'a'.",
      },
      {
        name: "Anchor & Nudge",
        description: "Reshape an already-drawn freehand stroke by dragging, inserting, or deleting its own anchor points, without redrawing it.",
      },
    ],
  },
  {
    title: "Organize your alphabet",
    features: [
      {
        name: "Character sets",
        description: "Latin Basic, Central European accents, punctuation, and currency/math symbols — toggle whole sets on or off in Grid View.",
      },
      {
        name: "Ligatures & alternates",
        description: "Tag a drawn shape as a ligature (e.g. 'fi') or a stylistic alternate of an existing letter — both export as real OpenType substitution glyphs.",
      },
      {
        name: "Custom glyphs",
        description: "Add any one-off base character, ligature, or alternate outside the built-in sets by name.",
      },
    ],
  },
  {
    title: "Edit & arrange",
    features: [
      {
        name: "Select, Move, Rotate, Scale",
        description: "Lasso-select any combination of strokes and vector shapes, then transform them as a group.",
      },
      {
        name: "Copy & paste",
        description:
          "Duplicate strokes and shapes within Free Draw, within Grid, or across the two — paste into a different Grid cell and it's automatically fitted to size.",
      },
      {
        name: "Undo/redo",
        description: "A full history stack covering drawing, tagging, and transform actions.",
      },
    ],
  },
  {
    title: "Compose & preview",
    features: [
      {
        name: "Editor view",
        description: "Type freely using your own already-tagged glyphs to see how your in-progress font reads as real text.",
      },
      {
        name: "Animate",
        description: "Apply CSS-driven animations (pulse, tilt, glitch, and more) to your lettering and export it as a self-contained HTML embed.",
      },
    ],
  },
  {
    title: "Export anywhere",
    features: [
      {
        name: "OTF export",
        description: "A complete OpenType font file, compiled entirely in your browser — nothing is uploaded, nothing to install.",
      },
      {
        name: "Skeleton SVG export",
        description: "The raw stroke centerlines as an open SVG path, ready to bring into Glyphs.app or another vector tool for manual refinement.",
      },
      {
        name: "FFF project files",
        description: "Fontane's own save format — every stroke, glyph, and setting, so you can pause and resume a font later or move between devices.",
      },
      {
        name: "Glyphs.app import script",
        description: "A Python script for Glyphs.app that reads an FFF file directly and builds real glyphs with correct components and Bezier nodes.",
      },
    ],
  },
  {
    title: "Share your font",
    features: [
      {
        name: "Marketplace",
        description: "Publish a finished font for anyone to browse and download, or share a direct link to it.",
      },
      {
        name: "Provenance gate",
        description: "Before a font can be published, Fontane checks for a plausible history of real drawing activity — a lightweight guard against converted or stolen fonts.",
      },
    ],
  },
  {
    title: "Built for privacy",
    features: [
      {
        name: "No trackers",
        description: "No cookies, no third-party analytics or ad scripts, no persistent identifier written to your device.",
      },
      {
        name: "Local-first",
        description: "Your drawings live in your browser's own storage — nothing reaches our servers unless you explicitly export or publish.",
      },
    ],
  },
];

export default function FeaturesPage() {
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
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }}
      />
      <div style={{ maxWidth: 720, width: "100%" }}>
        <MarketplaceNav />

        <h1 style={{ fontSize: 28, marginBottom: 8 }}>Features</h1>
        <p style={{ marginBottom: 40, fontSize: 14, lineHeight: 1.7, opacity: 0.75 }}>
          Everything Fontane.Studio can do today, running entirely in your browser — from a first pressure-sensitive
          sketch to a finished, exportable font.
        </p>

        {SECTIONS.map((section) => (
          <section key={section.title} style={{ marginBottom: 40 }}>
            <h2
              style={{
                fontSize: 18,
                marginBottom: 16,
                paddingBottom: 8,
                borderBottom: "1px solid rgba(31,25,52,0.15)",
              }}
            >
              {section.title}
            </h2>
            {section.features.map((f) => (
              <div key={f.name} style={{ marginBottom: 16 }}>
                <h3 style={{ fontSize: 15, marginBottom: 4 }}>{f.name}</h3>
                <p style={{ fontSize: 14, lineHeight: 1.7, opacity: 0.85 }}>{f.description}</p>
              </div>
            ))}
          </section>
        ))}
      </div>
    </div>
  );
}
