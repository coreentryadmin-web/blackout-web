export const IMAGES = {
  brandEmblem: "/images/blackout-emblem.webp",
  ogImage: "/og-image.webp",
} as const;

/** Live desk screenshots for marketing module showcase (webp, ~1200px wide). */
export const MARKETING_MODULE_IMAGES = {
  spx: "/images/marketing/spx.webp",
  helix: "/images/marketing/helix.webp",
  thermal: "/images/marketing/thermal.webp",
  largo: "/images/marketing/largo.webp",
  hawk: "/images/marketing/hawk.webp",
  meridian: "/images/marketing/thermal.webp",
  vector: "/images/marketing/vector.webp",
} as const;

export type MarketingModuleId = keyof typeof MARKETING_MODULE_IMAGES;

/**
 * Per-product screenshot GALLERY — the deep-dive carousel shows every shot listed
 * here (one image = static, two or more = a slider). The first entry is the
 * primary shot (also used anywhere a single image is needed).
 *
 * To add more shots for a product: drop the webp in `public/images/marketing/`
 * (convention: `<id>-2.webp`, `<id>-3.webp`, …, 4K source → webp q92) and add its
 * path to that product's array below. Order here is the order shown.
 */
export const MARKETING_MODULE_GALLERY: Record<MarketingModuleId, readonly string[]> = {
  spx: [MARKETING_MODULE_IMAGES.spx],
  helix: [MARKETING_MODULE_IMAGES.helix, "/images/marketing/helix-2.webp", "/images/marketing/helix-3.webp", "/images/marketing/helix-4.webp"],
  thermal: [MARKETING_MODULE_IMAGES.thermal, "/images/marketing/thermal-2.webp", "/images/marketing/thermal-3.webp", "/images/marketing/thermal-4.webp"],
  largo: [MARKETING_MODULE_IMAGES.largo, "/images/marketing/largo-2.webp"],
  hawk: [MARKETING_MODULE_IMAGES.hawk],
  meridian: [MARKETING_MODULE_IMAGES.meridian],
  vector: [MARKETING_MODULE_IMAGES.vector, "/images/marketing/vector-2.webp", "/images/marketing/vector-3.webp", "/images/marketing/vector-4.webp"],
};

/** Assets still referenced by the live site (guard / docs). */
export const IMAGE_FILES = [
  { path: "public/images/blackout-emblem.webp", label: "Brand emblem — marketing hero" },
  { path: "public/og-image.webp", label: "Social share preview (webp, default)" },
  { path: "public/og-image.png", label: "Social share preview (png fallback)" },
] as const;
