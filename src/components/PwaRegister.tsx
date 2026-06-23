"use client";

import { useEffect } from "react";

/**
 * Registers the PWA service worker for installability + offline shell.
 * Null-rendering, like SessionCacheGuard. Registration is gated to production so
 * dev/HMR is never disrupted by a controlling SW. The SW itself never caches
 * API or authenticated navigation responses (see public/sw.js).
 */
export function PwaRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;

    const onLoad = () => {
      navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch((err) => {
        // Non-fatal: PWA is a progressive enhancement.
        console.warn("[pwa] service worker registration failed", err);
      });
    };

    if (document.readyState === "complete") onLoad();
    else window.addEventListener("load", onLoad, { once: true });
    return () => window.removeEventListener("load", onLoad);
  }, []);

  return null;
}
