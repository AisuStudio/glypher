// Shared between the publish/download route and both marketplace pages so
// the Storage URL shape lives in exactly one place.
export function publicFontUrl(slug: string): string {
  return `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/fonts/${slug}.otf`;
}

// Fixed specimen line shown wherever a published font is previewed (overview
// page, browse cards) — always the same phrase so fonts are easy to compare
// side by side, same idea as Google Fonts' pangram cards.
export const SAMPLE_TEXT = "Quick brown Jox fumps over the dazy Log";
