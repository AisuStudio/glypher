import Link from "next/link";
import { getSupabase } from "@/lib/supabase";
import { publicFontUrl, SAMPLE_TEXT } from "@/lib/marketplace";
import PageviewTracker from "./PageviewTracker";
import MarketplaceNav from "./MarketplaceNav";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Marketplace — Fontane.Studio",
  description: "Fonts published with Fontane.Studio — free to download.",
};

type FontRow = {
  slug: string;
  display_name: string;
  glyph_count: number;
  download_count: number;
  created_at: string;
  author_name: string | null;
};

async function getFonts(): Promise<{ fonts: FontRow[]; ok: boolean }> {
  const supabase = getSupabase();
  if (!supabase) return { fonts: [], ok: false };
  const { data, error } = await supabase
    .from("fontane_fonts")
    .select("slug, display_name, glyph_count, download_count, created_at, author_name")
    .order("created_at", { ascending: false });
  if (error) return { fonts: [], ok: false };
  return { fonts: data ?? [], ok: true };
}

export default async function MarketplacePage() {
  const { fonts, ok } = await getFonts();

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
        <h1 style={{ fontSize: 28, marginBottom: 4 }}>Marketplace</h1>
        <p style={{ opacity: 0.6, marginBottom: 32, fontSize: 14 }}>
          Fonts published with Fontane.Studio — free to download, unrestricted use.
        </p>

        {!ok && (
          <p style={{ color: "#5100ff", marginBottom: 24 }}>
            Storage isn&apos;t connected yet (Supabase env vars missing).
          </p>
        )}

        {ok && fonts.length === 0 && <p style={{ opacity: 0.6 }}>No fonts published yet.</p>}

        {fonts.length > 0 && (
          <style>{`${fonts
            .map((font) => `@font-face { font-family: "mp-${font.slug}"; src: url("${publicFontUrl(font.slug)}") format("opentype"); font-display: swap; }`)
            .join("\n")}`}</style>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {fonts.map((font) => (
            <Link
              key={font.slug}
              href={`/marketplace/${font.slug}`}
              style={{
                display: "block",
                padding: "16px 20px",
                borderRadius: 6,
                border: "1px solid rgba(31,25,52,0.15)",
                color: "#1f1934",
                textDecoration: "none",
              }}
            >
              <div style={{ fontSize: 18 }}>
                {font.display_name}
                {font.author_name && <span style={{ opacity: 0.6, fontWeight: "normal" }}> by {font.author_name}</span>}
              </div>
              <div style={{ opacity: 0.6, fontSize: 13, marginTop: 4 }}>
                {font.glyph_count} glyphs · {font.download_count} downloads · {new Date(font.created_at).toLocaleDateString()}
              </div>
              <div
                style={{
                  fontFamily: `"mp-${font.slug}", sans-serif`,
                  fontSize: 22,
                  marginTop: 8,
                  wordBreak: "break-word",
                }}
              >
                {SAMPLE_TEXT}
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
