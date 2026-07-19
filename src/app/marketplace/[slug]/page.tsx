import { notFound } from "next/navigation";
import { getSupabase } from "@/lib/supabase";
import { publicFontUrl, getFontGlyphSheet, SAMPLE_TEXT } from "@/lib/marketplace";
import ShareButton from "./ShareButton";
import PageviewTracker from "../PageviewTracker";
import MarketplaceNav from "../MarketplaceNav";

export const dynamic = "force-dynamic";

type FontRow = {
  slug: string;
  display_name: string;
  glyph_count: number;
  download_count: number;
  created_at: string;
  author_name: string | null;
  author_url: string | null;
};

async function getFont(slug: string): Promise<FontRow | null> {
  const supabase = getSupabase();
  if (!supabase) return null;
  const { data } = await supabase
    .from("fontane_fonts")
    .select("slug, display_name, glyph_count, download_count, created_at, author_name, author_url")
    .eq("slug", slug)
    .maybeSingle();
  return data;
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const font = await getFont(slug);
  return { title: font ? `${font.display_name} — Fontane.Studio Marketplace` : "Font not found — Fontane.Studio" };
}

export default async function FontOverviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ notrack?: string }>;
}) {
  const { slug } = await params;
  const { notrack } = await searchParams;
  const [font, glyphSheet] = await Promise.all([getFont(slug), getFontGlyphSheet(slug)]);
  if (!font) notFound();

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
      <PageviewTracker />
      <div style={{ maxWidth: 720, width: "100%" }}>
        <MarketplaceNav />
        <h1 style={{ fontSize: 32, margin: "12px 0 4px" }}>{font.display_name}</h1>
        <p style={{ opacity: 0.6, marginBottom: font.author_name ? 4 : 32, fontSize: 14 }}>
          {font.glyph_count} glyphs · {font.download_count} downloads · published {new Date(font.created_at).toLocaleDateString()}
        </p>
        {font.author_name && (
          <p style={{ opacity: 0.6, marginBottom: 32, fontSize: 14 }}>
            by{" "}
            {font.author_url ? (
              <a href={font.author_url} style={{ color: "#1f1934" }} target="_blank" rel="noopener noreferrer nofollow">
                {font.author_name}
              </a>
            ) : (
              font.author_name
            )}
          </p>
        )}
        <style>{`@font-face { font-family: "mp-${font.slug}"; src: url("${publicFontUrl(font.slug)}") format("opentype"); font-display: swap; }`}</style>
        <p
          style={{
            fontFamily: `"mp-${font.slug}", sans-serif`,
            fontSize: 32,
            lineHeight: 1.3,
            marginBottom: 32,
            wordBreak: "break-word",
          }}
        >
          {SAMPLE_TEXT}
        </p>
        <p style={{ marginBottom: 32, fontSize: 14 }}>
          Published under an unrestricted license — free for personal and commercial use, no attribution required.
        </p>
        <div style={{ display: "flex", gap: 12 }}>
          <a
            href={`/api/fonts/${font.slug}/download${notrack !== undefined ? "?notrack" : ""}`}
            style={{
              font: "inherit",
              padding: "10px 20px",
              borderRadius: 6,
              background: "#1f1934",
              color: "#eae8e0",
              textDecoration: "none",
            }}
          >
            Download .otf
          </a>
          <ShareButton slug={font.slug} />
        </div>

        {glyphSheet && glyphSheet.glyphs.length > 0 && (
          <div style={{ marginTop: 40 }}>
            <h2 style={{ fontSize: 16, marginBottom: 16, opacity: 0.6 }}>all glyphs ({glyphSheet.glyphs.length})</h2>
            {/* Rendered directly from each glyph's own outline, not through
                @font-face text — ligature/alternate glyphs have no cmap
                entry (no GSUB either), so typing text can never reach them.
                This is the only view that shows literally every glyph. */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(48px, 1fr))", gap: 4 }}>
              {glyphSheet.glyphs.map((g) => (
                <svg
                  key={g.name}
                  viewBox={`0 ${-glyphSheet.ascender} ${g.advanceWidth} ${glyphSheet.ascender - glyphSheet.descender}`}
                  preserveAspectRatio="xMidYMid meet"
                  style={{ width: "100%", height: 48, border: "1px solid rgba(31,25,52,0.15)", borderRadius: 4 }}
                >
                  <title>{g.name}</title>
                  <path d={g.d} fill="#1f1934" />
                </svg>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
