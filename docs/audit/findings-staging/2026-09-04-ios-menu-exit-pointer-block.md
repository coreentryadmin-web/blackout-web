## 2026-09-04 — [FINDING, P2 ui-interaction, iOS native shell] Command deck exit animation blocked bottom-tab taps for ~200ms — FIXED

> **kind:** `FINDING`

| Field | Detail |
|---|---|
| **What prompted this** | `npm run test:ios-ui-e2e` TimeoutError: `.ios-native-menu-overlay` intercepted pointer events on `.ios-app-tab-link` after the harness opened and closed the command deck. |
| **Root cause** | `IosAppChrome` clears `nav-locked` and `menuOpen` immediately on close, but `AnimatePresence` keeps the full-screen overlay (z-index 110, tab bar 95) mounted through the exit spring with `pointer-events: auto`. |
| **Fix** | `html:not(.nav-locked) .ios-native-menu-overlay { pointer-events: none; }` in `ios-native.css`. Harness: `closeCommandDeck` before each tab hop + force-click fallback on tab links. |
| **Regression guard** | `src/components/ios/ios-native-menu-exit-pointer.test.ts` |
| **Status** | FIXED |
