/** GA4 recommended + custom funnel event names for BlackOut attribution. */

export const GA4_EVENTS = {
  pricingView: "pricing_view",
  signUpStarted: "sign_up_started",
  signUp: "sign_up",
  learnArticleRead: "learn_article_read",
  deskOpened: "desk_opened",
  beginCheckout: "begin_checkout",
  purchase: "purchase",
  experimentExposure: "experiment_exposure",
} as const;

export type Ga4EventName = (typeof GA4_EVENTS)[keyof typeof GA4_EVENTS];

/** Product desk routes — first authenticated visit fires desk_opened once per session. */
export const DESK_PATH_PREFIXES = [
  "/dashboard",
  "/flows",
  "/heatmap",
  "/nighthawk",
  "/terminal",
  "/vector",
] as const;

export function isDeskPath(pathname: string): boolean {
  return DESK_PATH_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export function learnArticleSlugFromPath(pathname: string): string | null {
  if (!pathname.startsWith("/learn/")) return null;
  const rest = pathname.slice("/learn/".length);
  if (!rest || rest.includes("/")) return null;
  // Curriculum chapter hubs use short slugs; SEO articles use kebab-case slugs.
  if (rest === "glossary") return null;
  return rest;
}
