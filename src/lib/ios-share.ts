import { isIosAppShell } from "@/lib/ios-app-shell";

// Native iOS share sheet via Capacitor's Share plugin. Falls back to the Web
// Share API on the web, then to a copy-to-clipboard "shared" toast if neither
// is available. Callers get one promise-based API and never need to branch
// on "am I in the app?" themselves.
//
// Why this belongs here (not just a `navigator.share` call):
//   - navigator.share works in Safari, but not inside a Capacitor WKWebView
//     with `limitsNavigationsToAppBoundDomains: false` (which we set) — it
//     silently rejects with "Permission denied." The native plugin routes to
//     `UIActivityViewController` instead, which is the correct iOS UX and
//     works reliably.
//   - Copy-fallback covers the "share panel is unavailable" case (older
//     desktop browsers, embedded contexts) so the caller can still count on
//     an action-took-effect result.

export interface ShareOptions {
  title?: string;
  text?: string;
  /** Optional URL to share; if omitted, `text` alone is shared. */
  url?: string;
  /** Optional dialog title on Android — no effect on iOS. */
  dialogTitle?: string;
}

export type ShareResult =
  | { channel: "native"; success: true }
  | { channel: "web-share"; success: true }
  | { channel: "clipboard"; success: true }
  | { channel: "none"; success: false; reason: string };

type CapShare = {
  share: (opts: ShareOptions) => Promise<{ activityType?: string }>;
};

function sharePlugin(): CapShare | undefined {
  if (typeof window === "undefined") return undefined;
  const cap = (window as Window & { Capacitor?: { Plugins?: { Share?: CapShare } } }).Capacitor;
  return cap?.Plugins?.Share;
}

/**
 * Share content using the best available channel for this environment.
 *
 * Order:
 *   1. Native iOS `UIActivityViewController` (Capacitor Share plugin) — only
 *      inside the iOS app shell.
 *   2. Web Share API — Safari desktop, mobile browsers that support it.
 *   3. Clipboard fallback — anywhere else; copies "title\n\nurl" or the raw
 *      text so the user can paste into whatever they wanted anyway.
 *
 * Never throws — a share flow that a user cancelled or a browser refused is
 * a common, non-exceptional outcome; the returned envelope reports it so
 * callers can render a toast without a try/catch dance.
 */
export async function iosShare(opts: ShareOptions): Promise<ShareResult> {
  // Prefer the native plugin when we're inside the app AND the plugin loaded.
  if (isIosAppShell()) {
    const p = sharePlugin();
    if (p) {
      try {
        await p.share(opts);
        return { channel: "native", success: true };
      } catch (err) {
        // Cancellation is the expected path when a user backs out of the
        // sheet. Treat it as success:false without a scary reason so callers
        // can just silently ignore.
        const msg = String((err as { message?: unknown } | undefined)?.message ?? err ?? "");
        return { channel: "none", success: false, reason: msg || "cancelled" };
      }
    }
    // Native shell without the plugin loaded (very rare — install glitch).
    // Fall through to Web Share / clipboard rather than failing.
  }

  // Web Share API — available in Safari (all platforms) and most Chromium.
  const nav = typeof navigator !== "undefined" ? navigator : undefined;
  if (nav && typeof nav.share === "function") {
    try {
      await nav.share({ title: opts.title, text: opts.text, url: opts.url });
      return { channel: "web-share", success: true };
    } catch (err) {
      const msg = String((err as { message?: unknown } | undefined)?.message ?? err ?? "");
      // AbortError = user cancelled; NotAllowedError = user gesture missing
      // (rare — we always call from a click handler). Fall through to
      // clipboard for NotAllowed; report cancel for AbortError.
      if (/AbortError|cancel/i.test(msg)) {
        return { channel: "none", success: false, reason: "cancelled" };
      }
    }
  }

  // Clipboard fallback — writes the text a caller supplied, or `title\n\nurl`
  // when text is empty.
  if (nav?.clipboard && typeof nav.clipboard.writeText === "function") {
    const parts: string[] = [];
    if (opts.text) parts.push(opts.text);
    if (opts.title && !opts.text) parts.push(opts.title);
    if (opts.url) parts.push(opts.url);
    const payload = parts.join("\n\n").trim();
    if (payload) {
      try {
        await nav.clipboard.writeText(payload);
        return { channel: "clipboard", success: true };
      } catch (err) {
        const msg = String((err as { message?: unknown } | undefined)?.message ?? err ?? "");
        return { channel: "none", success: false, reason: msg || "clipboard-failed" };
      }
    }
  }

  return { channel: "none", success: false, reason: "no-share-channel-available" };
}
