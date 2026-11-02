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

/**
 * Product desk routes — first authenticated visit fires desk_opened once per session.
 *
 * BUG FIX: this list was written in PR #1533, before the Meridian desk existed (added in
 * #2250/#2251), and was never updated when Meridian joined the product lineup. Every OTHER
 * canonical desk-route list in the codebase already carries all 7 desks — `DESK_NAV_LINKS`
 * (desk-nav-links.ts, the single source Nav.tsx/DeskSidebar.tsx both read from),
 * `IOS_TOOL_ROUTES`/`IOS_NATIVE_SHELL_PATH_PREFIXES` (ios-tool-routes.ts) — but this one stayed
 * at 6, so `isDeskPath("/meridian")` returned false and a member's first authenticated visit to
 * Meridian in a session never fired the `desk_opened` GA4 funnel event. Every other desk has
 * been reporting real engagement to GA4 since launch; Meridian has been silently under-counted
 * the entire time, with no error anywhere — a missing analytics event looks identical to a desk
 * nobody visited.
 */
export const DESK_PATH_PREFIXES = [
  "/dashboard",
  "/flows",
  "/heatmap",
  "/nighthawk",
  "/terminal",
  "/vector",
  "/meridian",
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
