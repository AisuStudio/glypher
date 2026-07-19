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
      url: "https://fontane.studio/legal",
      lastModified: "2026-07-19",
      changeFrequency: "yearly",
      priority: 0.3,
    },
  ];
}
