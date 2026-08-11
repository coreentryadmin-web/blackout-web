import localFont from "next/font/local";

/**
 * Desk/auth monospace — omit from root layout so marketing pages skip the ~30KB font payload.
 *
 * COMMITTED, NOT FETCHED. See the note in `src/app/layout.tsx`: a `next/font/google` fetch failure
 * during `next build` took a whole production deploy down on 2026-08-11. This module and
 * `fonts-sans.ts` are the other two build-time fetches in the app; leaving either would have left
 * the build exactly as fragile, since both are loaded by the desk and both auth layouts.
 *
 * Same file the root layout uses — JetBrains Mono ships ONE variable woff2 covering every weight,
 * so the 400/500 this module asked for and the 400/500/600/700 the root layout asked for are the
 * identical bytes. The path is shared rather than duplicated.
 */
export const jetbrainsMono = localFont({
  src: "../app/fonts/jetbrains-mono-variable.woff2",
  weight: "100 800",
  style: "normal",
  display: "swap",
  variable: "--font-jetbrains",
});
