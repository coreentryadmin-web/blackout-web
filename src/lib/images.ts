export const IMAGES = {
  heroBanner: "/images/hero-banner.png",
  heroCommand: "/images/hero-command-desk.jpg",
  brandEmblem: "/images/blackout-emblem.webp",
  nighthawkOperator: "/images/nighthawk-operator.jpg",
  dashboardBg: "/images/dashboard-bg.png",
  ogImage: "/opengraph-image",
  authBg: "/images/hero-banner.png",
} as const;

/** Live desk screenshots for marketing module showcase (webp, ~1200px wide). */
export const MARKETING_MODULE_IMAGES = {
  spx: "/images/marketing/spx.webp",
  helix: "/images/marketing/helix.webp",
  thermal: "/images/marketing/thermal.webp",
  largo: "/images/marketing/largo.webp",
  hawk: "/images/marketing/hawk.webp",
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
  helix: [MARKETING_MODULE_IMAGES.helix],
  thermal: [MARKETING_MODULE_IMAGES.thermal],
  largo: [MARKETING_MODULE_IMAGES.largo],
  hawk: [MARKETING_MODULE_IMAGES.hawk],
  vector: [MARKETING_MODULE_IMAGES.vector],
};

export const IMAGE_FILES = [
  { path: "public/images/hero-banner.png", label: "BlackOut Trading Community (hero)" },
  { path: "public/images/blackout-emblem.webp", label: "Brand emblem — marketing hero" },
  { path: "public/images/hero-command-desk.jpg", label: "Landing hero — operator command desk (cinematic background)" },
  { path: "public/images/nighthawk-operator.jpg", label: "Night Hawk screen — night-vision operator (cinematic background)" },
  { path: "public/images/dashboard-bg.png", label: "Dashboard ambient background" },
  { path: "public/images/og-image.png", label: "Social share preview" },
] as const;
