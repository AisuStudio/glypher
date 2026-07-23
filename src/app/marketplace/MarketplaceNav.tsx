import Link from "next/link";

// Minimal top nav for the marketplace pages — just enough to get back to
// the editor, unlike the main app's full File/Edit/View/Tools menu bar
// which doesn't belong here.
export default function MarketplaceNav() {
  return (
    <nav style={{ display: "flex", gap: 20, alignItems: "baseline", marginBottom: 32, fontSize: 14 }}>
      <span style={{ fontWeight: "bold" }}>Fontane.Studio</span>
      <Link href="/" style={{ color: "#1f1934", opacity: 0.7, textDecoration: "none" }}>
        Editor
      </Link>
      <Link href="/marketplace" style={{ color: "#1f1934", opacity: 0.7, textDecoration: "none" }}>
        Marketplace
      </Link>
      <Link href="/features" style={{ color: "#1f1934", opacity: 0.7, textDecoration: "none" }}>
        Features
      </Link>
    </nav>
  );
}
