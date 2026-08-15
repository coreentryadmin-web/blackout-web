"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { useAppAuth } from "@/lib/auth-client";
import { isIosAppShell, isIosNativeEmbed } from "@/lib/ios-app-shell";
import { getIosRouteKey, isIosNativeShellRoute } from "@/lib/ios-tool-routes";
import type { ToolKey } from "@/lib/tool-access";
import { IosNativeHeader } from "./IosNativeHeader";
import { IosNativeMenu } from "./IosNativeMenu";
import { IosLargoFab } from "./IosLargoFab";
import { useAdminFlag } from "@/hooks/use-admin-flag";

/**
 * Native iOS product shell — replaces the web Nav on signed-in routes inside
 * the Capacitor WKWebView. Web marketing/auth surfaces keep the standard Nav.
 */
export function IosAppChrome({ lockedTools = [] }: { lockedTools?: ToolKey[] }) {
  const path = usePathname();
  const { isSignedIn, isLoaded } = useAppAuth();
  const [iosApp, setIosApp] = useState(false);
  const [nativeEmbed, setNativeEmbed] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const isAdmin = useAdminFlag();

  useEffect(() => {
    setIosApp(isIosAppShell());
    setNativeEmbed(isIosNativeEmbed());
  }, []);

  useEffect(() => {
    setMenuOpen(false);
  }, [path]);

  useEffect(() => {
    document.documentElement.classList.toggle("nav-locked", menuOpen);
    return () => document.documentElement.classList.remove("nav-locked");
  }, [menuOpen]);

  const nativeActive =
    iosApp && isLoaded && isSignedIn && isIosNativeShellRoute(path);

  /* Drop head-script pending flag once we know shell state (avoids Nav flash). */
  useEffect(() => {
    if (!iosApp) return;
    if (isLoaded && !isSignedIn) {
      document.documentElement.classList.remove("ios-app-pending-shell");
    }
    if (nativeActive) {
      document.documentElement.classList.remove("ios-app-pending-shell");
    }
  }, [iosApp, isLoaded, isSignedIn, nativeActive]);

  useEffect(() => {
    document.documentElement.classList.toggle("ios-native-shell", nativeActive);
    return () => document.documentElement.classList.remove("ios-native-shell");
  }, [nativeActive]);

  useEffect(() => {
    if (!nativeActive) {
      document.documentElement.removeAttribute("data-ios-route");
      return;
    }
    document.documentElement.setAttribute("data-ios-route", getIosRouteKey(path));
    return () => document.documentElement.removeAttribute("data-ios-route");
  }, [nativeActive, path]);

  if (!nativeActive) return null;
  // Native SwiftUI embeds the desk in its own NavigationStack — skip web chrome.
  if (nativeEmbed) return null;

  return (
    <>
      <div className="ios-native-ambient" aria-hidden />
      <IosNativeHeader path={path} onMenuOpen={() => setMenuOpen(true)} />
      <IosNativeMenu
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        lockedTools={lockedTools}
        showAdmin={isAdmin}
      />
      <IosLargoFab />
    </>
  );
}
