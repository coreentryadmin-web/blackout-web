# iOS Premium Program — autonomous build-to-perfect tracker

**Mandate (owner, 2026-07-26):** make the BlackOut iOS app premium end-to-end — every page,
navigation, button, layout — commercial/corporate/high-class. Wire Face ID + native iOS
enhancements. Drive it autonomously; validate on the real iOS UI; don't ask the owner to test.
Report only when it's genuinely ready.

**This file is the source of truth.** Every work cycle: read this → do the next unchecked item(s)
→ commit → merge when CI green → deploy → validate on the iPhone render → update this file. It
survives context resets; resume from here.

---

## Architecture facts (verified 2026-07-26)

- The iOS app = a **Capacitor 6 WKWebView** (`apps/blackout-ios/`) that loads **live prod**
  `https://blackouttrades.com`. So "every page of the app" = the web app's pages rendered under the
  iOS shell UA (`BlackOutiOSApp`), plus native chrome. Web changes reach the app the moment prod
  deploys — no rebuild needed. Only icon/splash/native-plugin changes need a fresh build.
- **iOS detection is 100% client-side**: an inline `<head>` script in `src/app/layout.tsx:80-98`
  adds `html.ios-app` (+ `ios-tier-pro`/`pro-max`) when UA matches. `isIosAppShell()`
  (`src/lib/ios-app-shell.ts`) reads that class. Dual-render CSS `.hide-in-ios-app` /
  `.show-in-ios-app` (defined in `globals.css` AND `marketing-base.css`) is the primary gate.
- **Existing native shell is substantial** (this is polish/complete, not from scratch): 13
  `ios-native*.css` files (imported in `src/app/(site)/layout.tsx`), native header
  (`IosNativeHeader`), command-deck menu (`IosNativeMenu`), instrument tab bar (`IosAppTabBar`),
  page transitions (`IosNativePageTransition`), viewport lock, keyboard inset, haptics
  (`src/lib/ios-haptics.ts` — the one fully-wired native bridge).
- **Tab bar (5):** `/dashboard` SPX Slayer · `/flows` HELIX · `/heatmap` Thermal · `/terminal`
  Largo (rail auto-hides) · `/nighthawk` Night Hawk. Plus `/vector` (native chrome, non-tab) and
  utility routes `/account /faq /learn /upgrade /admin`. Registry: `src/lib/ios-tool-routes.ts`.
- **Full page inventory** (native-shell prefixes: dashboard, flows, heatmap, terminal, nighthawk,
  vector, account, faq, learn, upgrade, admin):
  - `(site)`: /dashboard /flows /heatmap /terminal /nighthawk /vector /account /track-record*
    /admin/** /dev/** (*track-record & dev get NO native chrome — gap)
  - `(marketing)`: / (home) /pricing (hidden in-app) /upgrade /faq /learn/**
  - top-level: /sign-in /sign-up /offline /embed/track-record
- **Deploy:** prod repo `blackout-web` (Clerk) → `ecr-push-production.yml` on push to `main` →
  ECS `blackout-production` → Cloudflare purge. Staging = separate sandbox repo
  `blackout-web-sandbox` (Cognito). The Capacitor shell loads **prod**, so iOS-shell validation
  targets prod. **Blast radius today = ~zero**: the iOS app is not on the App Store yet, so
  `html.ios-app` code paths have no live users except our own audit harness. iOS-gated changes are
  safe to ship to prod.

## Native capabilities status

| Capability | State | Plan |
|---|---|---|
| Haptics | ✅ wired (`ios-haptics.ts`) | keep; extend to more actions |
| Splash / status bar | ⚠️ config-only, plugin never called | call `StatusBar.*`; real splash from `assets/splash.png` |
| Push (APNs) | ❌ web-push only (inert in WKWebView) | wire `@capacitor/push-notifications` register → native token table → server APNs sender |
| Face ID / biometric app-lock | ❌ advertised, not wired | add biometric plugin + resume gate + settings toggle |
| Deep links (`@capacitor/app` appUrlOpen) | ❌ dep present, unused | route pushed alerts → correct desk |
| Share (`@capacitor/share`) | ❌ absent | native share of a chart/play |

---

## Validation harness (the "eyes")

`scripts/ios/ios-ui-audit.mjs` — mints a temp premium Clerk session, renders any page list at true
iPhone resolution (430×932 @3 = App-Store 6.9") with the `BlackOutiOSApp` UA, through the agent
proxy bridge; screenshots + console-error capture; deletes the temp user. Real routes only.
```
env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY node scripts/ios/ios-ui-audit.mjs \
  --base https://blackouttrades.com --out artifacts/ios-<stage> \
  --pages "/dashboard,/flows,/heatmap,/terminal,/nighthawk,/vector,/account"
```
Existing complementary harness: `npm run test:ios-ui-e2e` (`scripts/ios-native-ui-e2e.mjs`) — clicks
tabs/segments/controls, asserts shell classes, two device passes. Reuse + grow it.

---

## Backlog (priority order) — check off as done

### P0 — Submission blockers
- [ ] **P0-1 `/privacy` page** — Apple requires a working Privacy Policy URL; route does not exist. Additive.
- [x] **P0-2 Homepage pricing leak (3.1.1)** — gated `#rl-pricing` + closing "See pricing" link with `hide-in-ios-app`; added a neutral `show-in-ios-app` membership note (no price/purchase) in their place. Web unchanged. Done 2026-07-26 (commit pending deploy-validation on the iPhone render).
- [ ] **P0-3 Server-side iOS detection (durable 3.1.1)** — read `BlackOutiOSApp` UA on the server; render neutral variants so pricing/purchase markup never ships to the app (today it's CSS-hidden but present in DOM).
- [x] **P0-4 Remove `*.whop.com` from `allowNavigation`** (`capacitor.config.ts`) so checkout can never open in-app. Done 2026-07-26.

### N — Native premium features
- [ ] **N-1 Face ID / biometric app-lock** — plugin + app-resume gate + Account toggle.
- [ ] **N-2 Real APNs push** — native register → token table → server sender; hide the inert web-push toggle in-app.
- [ ] **N-3 StatusBar calls + deep links (`appUrlOpen`) + native share.**
- [ ] **N-4 Head-script fix** — pending-shell regex omits `vector`, includes dead `grid` (anti-flash).

### U — Per-page premium polish (validate each on the iPhone render)
- [ ] **U-1 Dashboard (SPX Slayer)** · **U-2 Flows (HELIX)** · **U-3 Heatmap (Thermal)** · **U-4 Terminal (Largo)** · **U-5 Nighthawk** · **U-6 Vector** · **U-7 Account** · **U-8 Track-record (add native chrome — currently none)** · **U-9 FAQ/Learn** · **U-10 Upgrade** · **U-11 Sign-in/Sign-up** · **U-12 Offline** · **U-13 Home (marketing, in-app entry)**
- [ ] **U-sys** Cross-cutting: safe-area insets everywhere, 44pt touch targets, momentum scroll, no horizontal overflow, consistent type scale + tokens, tab-bar/header polish, page transitions, empty/loading/error states.

### I / M — Icon, assets, metadata, ship
- [x] **I-1 App icon 1024** from `public/images/blackout-emblem.webp` → `apps/blackout-ios/assets/icon.png` (opaque, no alpha).
- [x] **I-2 Splash** `assets/splash.png` + `splash-dark.png` (2732²) on `#040407`.
- [x] **I-3 Wire `@capacitor/assets`** into both CI configs (generates native sets from `assets/`).
- [x] **CI-1 GitHub Actions pipeline** completed (`.github/workflows/blackout-ios-testflight.yml`) — build+sign+upload+TestFlight via ASC key.
- [ ] **M-1 ASC listing** via API (needs owner sign-off before mutating live listing): name → "BlackOut", categories Finance/Business, age rating 4+, App Privacy labels, reviewer notes + walkthrough. Draft: `docs/ios/ASC-METADATA.md`.
- [ ] **M-2 App Store screenshots** (6.9" + 6.5") generated from the polished app via the audit harness.
- [ ] **M-3 Demo account** for Apple review (admin+premium Clerk user w/ password path; keep alive through review).
- [ ] **M-4 Delete stray MAC_OS 1.0 version** in ASC (iOS-only submission).
- [ ] **SHIP — owner's one action:** inject the ASC API key into CI once (Codemagic integration "BlackOut ASC" **or** 3 GitHub secrets). Then builds+submit run autonomously. Everything else is automated.

### Reference docs
`docs/ios/ASC-METADATA.md` · `docs/ios/COMPLIANCE-3.1.1-AUDIT.md` · `docs/ios/NATIVE-VALUE-AND-PRIVACY-AUDIT.md` · `docs/audit/LIVE-UI-CONNECTION.md`

---

## Live status log (newest first)
- **2026-07-26** — Program bootstrapped. Verified ASC key + live app state (app exists, 1 valid build 2026-07-05, iOS 1.0 draft, metadata empty, stray MAC_OS version). Built the iOS UI audit harness + captured baseline. Generated premium app icon + splash from the brand emblem and wired `@capacitor/assets`. Completed the GitHub Actions build/ship pipeline. Ran the 4-part audit (CI/metadata/3.1.1/native-value). Next: P0 blockers → native features → per-page polish.
