import { isIosAppShell } from "@/lib/ios-app-shell";

// Web-side thin wrapper over Capacitor's StatusBar plugin (installed in
// apps/blackout-ios/package.json). Mirrors ios-haptics.ts: check that we're
// inside the WKWebView, then call the plugin through the global bridge,
// swallow every error (a missing plugin must never break the web app).
//
// Why we call it explicitly instead of relying on the Info.plist:
//   - The Info.plist declares UIStatusBarStyle = LightContent, but a mid-
//     session change (opening a sheet, entering keyboard) can flip the
//     effective style back to default if any UIViewController advertises a
//     different value. Setting it programmatically from the web layer at
//     app-shell mount + every route change gives us one source of truth.
//   - `setOverlaysWebView(true)` puts the WKWebView underneath the status
//     bar so the void #040407 background reaches the top of the screen —
//     without it, a black-status-bar gap sits above our own black background
//     (looks like a rendering bug at a glance; is actually the default).
//
// This module is intentionally a plain module (no React) so it can be called
// from `src/hooks/useIosNativeShell.ts` on iOS-shell mount.

type StatusBarStyle = "Dark" | "Light" | "Default";

type CapStatusBar = {
  setStyle: (opts: { style: StatusBarStyle }) => Promise<void>;
  setBackgroundColor: (opts: { color: string }) => Promise<void>;
  setOverlaysWebView: (opts: { overlay: boolean }) => Promise<void>;
  hide: () => Promise<void>;
  show: () => Promise<void>;
};

function statusBarPlugin(): CapStatusBar | undefined {
  if (typeof window === "undefined") return undefined;
  const cap = (window as Window & { Capacitor?: { Plugins?: { StatusBar?: CapStatusBar } } }).Capacitor;
  return cap?.Plugins?.StatusBar;
}

/**
 * Apply the BlackOut status-bar look: light content (white icons on the
 * void background) + overlaid so the void reaches the top of the screen.
 * Idempotent — safe to call on every route change; the plugin de-dupes.
 */
export function applyIosStatusBar(): void {
  if (!isIosAppShell()) return;
  const bar = statusBarPlugin();
  if (!bar) return;
  // In Capacitor 6 the `Style` enum literals are strings; the plugin accepts
  // either the enum or a matching string, but the string form is safe when
  // this module hasn't imported the actual plugin package.
  void bar.setStyle({ style: "Dark" }).catch(() => {});
  // Overlay lets the void reach the top; `setBackgroundColor` is a no-op on
  // iOS (Android-only), but calling it here documents intent + a future
  // Android port only needs the call to work.
  void bar.setOverlaysWebView({ overlay: true }).catch(() => {});
}

// NOTE on Capacitor's `Style` naming (source of many bugs): `Style.Dark`
// means "the content of the status bar is dark-adaptive → the app has a
// DARK background → the OS should render WHITE (light) status bar text on
// top." It reads backwards. BlackOut has a dark background, so `Dark` is
// correct — that's what makes the time / battery icons render in white.
