"use client";

import { useEffect, useState } from "react";
import { isIosAppShell } from "@/lib/ios-app-shell";

const COMPACT_QUERY = "(max-width: 767px)";

function readNarrowViewport(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia(COMPACT_QUERY).matches;
}

/** True on iOS native shell OR narrow mobile web — use segment switcher instead of triple stack. */
export function useCompactDeskPanels(nativeShell: boolean): boolean {
  const [narrow, setNarrow] = useState(readNarrowViewport);
  const [iosApp, setIosApp] = useState(() => {
    if (typeof document === "undefined") return false;
    return document.documentElement.classList.contains("ios-app");
  });

  useEffect(() => {
    setIosApp(isIosAppShell());
    const mq = window.matchMedia(COMPACT_QUERY);
    const sync = () => setNarrow(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  // ios-app must win on first paint — waiting for Clerk + nativeShell hid the segment
  // switcher and left the desktop desk grid on phone WKWebViews (broken toolbar overlap).
  return nativeShell || iosApp || narrow;
}
