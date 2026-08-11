import localFont from "next/font/local";

/**
 * Body sans — omit from root layout so marketing pages skip the ~20KB Inter payload.
 *
 * COMMITTED, NOT FETCHED — same reason as `fonts-mono.ts` and the root layout: a build-time fetch
 * of a third-party CDN is a deploy that fails on someone else's outage.
 *
 * Inter is a variable font; the single latin file covers the 400/500/600 this asked for.
 */
export const inter = localFont({
  src: "../app/fonts/inter-variable.woff2",
  weight: "100 900",
  style: "normal",
  display: "swap",
  variable: "--font-inter",
});
