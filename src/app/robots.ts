import type { MetadataRoute } from "next";
import { SITE } from "@/lib/site";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/dashboard",
          "/flows",
          "/heatmap",
          "/terminal",
          "/nighthawk",
          "/vector",
          "/grid",
          "/account",
          "/admin",
          "/sign-in",
          "/sign-up",
          "/upgrade",
          "/embed/",
          "/api/",
          "/_next/",
        ],
      },
    ],
    sitemap: `${SITE.url}/sitemap.xml`,
  };
}
