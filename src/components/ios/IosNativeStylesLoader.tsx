"use client";

import { useEffect } from "react";

/**
 * Desktop web never needs the ~210 KB iOS native CSS stack — but (site)/layout wraps
 * every product page. Load these sheets only when the inline boot script tagged
 * `html.ios-app` (BlackOutiOSApp UA), so Chrome/Firefox desk routes skip parse cost.
 */
export function IosNativeStylesLoader() {
  useEffect(() => {
    if (!document.documentElement.classList.contains("ios-app")) return;
    void Promise.all([
      import("../../app/ios-native.css"),
      import("../../app/ios-native-pages.css"),
      import("../../app/ios-native-nav.css"),
      import("../../app/ios-native-skin.css"),
      import("../../app/ios-native-motion.css"),
      import("../../app/ios-native-command.css"),
      import("../../app/ios-native-iphone16.css"),
      import("../../app/ios-native-viewport.css"),
      import("../../app/ios-native-input-lock.css"),
      import("../../app/ios-native-tokens.css"),
      import("../../app/ios-native-organize.css"),
      import("../../app/ios-native-tab-rail.css"),
      import("../../app/ios-native-cards.css"),
      import("../../app/ios-native-compact-controls.css"),
      import("../../app/ios-native-spx-desk.css"),
      import("../../app/ios-native-phase2.css"),
    ]);
  }, []);
  return null;
}
