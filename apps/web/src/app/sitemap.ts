import type { MetadataRoute } from "next";

const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL ??
  process.env.WEB_BASE_URL ??
  "https://courtwatch-reno-web.onrender.com";

const routes = ["/", "/install", "/support", "/privacy", "/terms"];

export default function sitemap(): MetadataRoute.Sitemap {
  return routes.map((route) => ({
    url: `${siteUrl}${route}`,
    lastModified: new Date(),
    changeFrequency: route === "/" ? "hourly" : "monthly",
    priority: route === "/" ? 1 : 0.6,
  }));
}
