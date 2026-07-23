import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: "https://fontane.studio",
      lastModified: "2026-07-17",
      changeFrequency: "monthly",
      priority: 1,
    },
    {
      url: "https://fontane.studio/marketplace",
      lastModified: "2026-07-18",
      changeFrequency: "weekly",
      priority: 0.7,
    },
    {
      url: "https://fontane.studio/features",
      lastModified: "2026-07-23",
      changeFrequency: "monthly",
      priority: 0.8,
    },
    {
      url: "https://fontane.studio/legal",
      lastModified: "2026-07-19",
      changeFrequency: "yearly",
      priority: 0.3,
    },
  ];
}
