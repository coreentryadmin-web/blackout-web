"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { applyIosStatusBar } from "@/lib/ios-status-bar";
import { initIosDeepLinks } from "@/lib/ios-deep-links";

/**
 * Runs the one-time native-plugin calls needed when the Capacitor shell
 * boots the web app: applies the BLACKOUT status bar look, and installs the
 * `appUrlOpen` deep-link listener so a tapped push notification routes to
 * the correct in-app path via Next.js client navigation.
 *
 * Sibling of `IosViewportLock` — both mount once at app-shell scope and are
 * no-ops outside the iOS app. Kept separate so a status-bar or deep-link
 * change doesn't require touching viewport-lock logic (each concern has a
 * single reason to change).
 *
 * Deliberately renders `null` — this is pure side-effect infrastructure.
 */
export function IosNativeInit() {
  const router = useRouter();

  useEffect(() => {
    // applyIosStatusBar is a no-op on web; safe to call unconditionally.
    // Called on every mount so a re-mount (fast-refresh, route pivot that
    // remounts the shell) re-applies the style.
    applyIosStatusBar();

    // Deep-link listener: routes push-notification-driven URLs to the
    // native-app-appropriate path via next/navigation.
    const cleanup = initIosDeepLinks((path) => {
      router.push(path);
    });
    return cleanup;
  }, [router]);

  return null;
}
