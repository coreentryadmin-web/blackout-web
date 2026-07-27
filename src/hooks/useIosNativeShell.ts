"use client";

/**
 * KILL-SWITCH (2026-07-27) — the native-shell layout was leaving HELIX, Thermal,
 * and Largo COMPLETELY BLANK for real TestFlight members (only page-header, no
 * content). Root cause is the flexbox+overflow:hidden layout swap:
 *   1. SSR ships the DESKTOP-mobile layout (no `ios-native-shell` class yet — the
 *      class is only added client-side after Clerk hydrates and `isSignedIn` flips
 *      true, since this hook depends on `useAppAuth`).
 *   2. On hydration, several pages (HelixPageShell, thermal shell, LargoPageShell)
 *      apply their `-native` classnames AND `IosAppChrome` stamps
 *      `html.ios-native-shell` + `data-ios-route="…"` on the root.
 *   3. The native-shell CSS then does `overflow: hidden` + `flex: 1` +
 *      `min-height: 0` on the page shell — which computes to a zero-height
 *      box whenever the flex-height chain from `<html>` down to the inner
 *      viewport isn't perfectly connected, and the content is clipped invisible.
 *      Dashboard survives because its wrappers happen to inherit height; the
 *      other three don't.
 *
 * The right fix is repairing the flex-height chain on each page shell (a real
 * layout change), but that needs its own PR with a live-render check per surface.
 * Until then, returning `false` makes every page fall back to the desktop-mobile
 * layout, which does render (proven with `scripts/ios/ios-diagnose.mjs` — every
 * page came back with real body text under this UA once the class-swap was off).
 *
 * KEEP THE IMPORTS + parameters exactly as they were so a follow-up PR that
 * repairs the layout can just delete the two `return false` lines and unblock
 * the native mode again without any other consumer changes.
 */
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { useAppAuth } from "@/lib/auth-client";
import { isIosAppShell } from "@/lib/ios-app-shell";
import { isIosNativeShellRoute } from "@/lib/ios-tool-routes";

/** True inside the Capacitor app on signed-in native-shell routes. */
export function useIosNativeShell(): boolean {
  const path = usePathname();
  const { isSignedIn, isLoaded } = useAppAuth();
  const [iosApp, setIosApp] = useState(false);

  useEffect(() => {
    setIosApp(isIosAppShell());
  }, []);

  // Kill-switch — see file header. Reference the inputs so ESLint / tsc don't
  // strip them and the diff stays minimal when re-enabling.
  void path;
  void isSignedIn;
  void isLoaded;
  void iosApp;
  return false;
}
