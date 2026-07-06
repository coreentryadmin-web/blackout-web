#!/usr/bin/env node
/**
 * Static + prod smoke checks for iOS / narrow-viewport SPX Slayer desk fixes.
 * Does not replace TestFlight on a physical device — validates deployable artifacts
 * and authenticated desk API shape from this environment.
 *
 * Usage: npm run validate:ios-mobile-desk
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { mintClerkPremiumSession } from "./audit/lib/prod-clerk-session.mjs";

const root = process.cwd();
const css = readFileSync(join(root, "src/app/globals.css"), "utf8");
const header = readFileSync(join(root, "src/components/desk/SpxSniperHeader.tsx"), "utf8");

const checks = [];
const ok = (name, detail = "") => {
  checks.push({ name, pass: true, detail });
  console.log(`  [PASS] ${name}${detail ? ` — ${detail}` : ""}`);
};
const fail = (name, detail = "") => {
  checks.push({ name, pass: false, detail });
  console.error(`  [FAIL] ${name}${detail ? ` — ${detail}` : ""}`);
};

console.log("validate:ios-mobile-desk — static CSS/component guards\n");

const cssNeedles = [
  ["html.ios-app {", "iOS safe-area nav offset"],
  ["--viewport-chrome", "viewport chrome token"],
  ["--ios-tab-offset", "iOS bottom tab bar offset token"],
  [".ios-app-tab-bar", "iOS bottom tab bar component styles"],
  ["html.ios-app.ios-tab-bar .nav-sheet-toggle", "hide hamburger when tab bar visible"],
  ["overflow-x: hidden", "WKWebView horizontal overflow guard"],
  ["html.nav-locked .nav-brand", "drawer-open nav wordmark hide"],
  ["html.ios-app .nav-auth .nav-push-slot", "hide push toggle from cramped top bar"],
  [".spx-hero-price", "mobile hero price scale hook"],
  ["grid-template-columns: repeat(2, minmax(0, 1fr))", "mobile metric block grid"],
  [".flow-scroll-max", "HELIX tape height clears nav + tab bar"],
  [".ios-tool-locked-screen", "ComingSoon nav clearance"],
  [".auth-mobile-pane", "sign-in safe-area padding"],
  [".ios-account-page", "account page nav offset"],
  ["html.ios-app .page-tool-header", "iOS compact page headers"],
  [".ios-app-tab-active-bar", "tab bar active glow indicator"],
  ["html.ios-app .nav-bar-ios-tool", "iOS tool context nav mode"],
  ["@keyframes ios-page-enter", "iOS page enter animation"],
  ["html.ios-app .flow-seg-btn", "iOS touch-sized segment buttons"],
  ["html.ios-app.ios-tab-bar .ios-desk-shell", "single bottom inset owner for desk"],
];

const nativeCss = readFileSync(join(root, "src/app/ios-native.css"), "utf8");
const nativeNeedles = [
  ["html.ios-app.ios-native-shell", "native shell scope"],
  ["--ios-header-offset", "native header offset token"],
  ["html.ios-app.ios-native-shell .nav-bar", "hide web nav in native shell"],
  [".ios-native-header", "native top bar"],
  [".ios-native-menu-sheet", "native bottom sheet menu"],
  ["html.ios-app.ios-native-shell .spx-sniper-identity", "hide duplicate SPX title"],
  ["html.ios-app.ios-native-shell.ios-tab-bar .page-tool-header", "hide duplicate page headers"],
  ["html.ios-app.ios-native-shell .ios-app-tab-bar", "floating dock tab bar"],
];
const pagesCss = readFileSync(join(root, "src/app/ios-native-pages.css"), "utf8");
const pagesNeedles = [
  [".ios-native-segment", "native segment control"],
  [".ios-native-panel-hidden", "panel switcher utility"],
  ['data-ios-route="dashboard"', "SPX native page scope"],
  ['data-ios-route="flows"', "HELIX native page scope"],
  ['data-ios-route="largo"', "Largo native page scope"],
  [".account-page-title-block", "account title hide hook"],
  [".helix-ios-toolbar", "HELIX sticky filter bar"],
  [".grid-page-tabs", "grid page tabs hook"],
];
for (const [needle, label] of pagesNeedles) {
  if (pagesCss.includes(needle)) ok(`pages-css:${label}`, needle);
  else fail(`pages-css:${label}`, `missing ${needle}`);
}
for (const [needle, label] of nativeNeedles) {
  if (nativeCss.includes(needle)) ok(`native-css:${label}`, needle);
  else fail(`native-css:${label}`, `missing ${needle}`);
}

const sourceNeedles = [
  ["src/components/IosAppTabBar.tsx", "IosAppTabBar"],
  ["src/components/ios/IosAppChrome.tsx", "IosAppChrome"],
  ["src/components/ios/IosNativePageTransition.tsx", "IosNativePageTransition"],
  ["src/lib/ios-tool-routes.ts", "ios-tool-routes"],
];
const navCss = readFileSync(join(root, "src/app/ios-native-nav.css"), "utf8");
const skinCss = readFileSync(join(root, "src/app/ios-native-skin.css"), "utf8");
const navNeedles = [
  [".ios-native-page-stage", "page transition stage"],
  [".ios-app-tab-indicator", "sliding tab indicator"],
  [".ios-native-segment-indicator", "sliding segment indicator"],
  ["ios-panel-enter", "internal panel crossfade"],
  ["animation: none !important", "disable legacy page enter"],
];
for (const [needle, label] of navNeedles) {
  if (navCss.includes(needle)) ok(`nav-css:${label}`, needle);
  else fail(`nav-css:${label}`, `missing ${needle}`);
}

const skinNeedles = [
  [".ios-native-ambient", "route ambient glow"],
  ["--ios-accent:", "route accent token"],
  ["--ios-surface-1", "glass surface token"],
  ["--ios-shadow-card", "card shadow token"],
  ["--ios-touch:", "touch target token"],
  [".flow-seg-btn-active-all", "segment active skin"],
  [".largo-suggestion-chip", "Largo chip skin"],
  [".nighthawk-play-row", "Night Hawk card skin"],
  [".ios-tool-locked-screen", "locked tool skin"],
  ['data-ios-route="flows"', "HELIX accent route"],
];
for (const [needle, label] of skinNeedles) {
  if (skinCss.includes(needle)) ok(`skin-css:${label}`, needle);
  else fail(`skin-css:${label}`, `missing ${needle}`);
}

const chrome = readFileSync(join(root, "src/components/ios/IosAppChrome.tsx"), "utf8");
if (chrome.includes("ios-native-ambient")) {
  ok("skin:ambient-layer-mounted");
} else {
  fail("skin:ambient-layer-mounted", "expected ios-native-ambient in IosAppChrome");
}

const tabBar = readFileSync(join(root, "src/components/IosAppTabBar.tsx"), "utf8");
if (tabBar.includes("layoutId") && tabBar.includes("scroll={false}")) {
  ok("nav:tab-bar-spring-indicator");
} else {
  fail("nav:tab-bar-spring-indicator", "expected layoutId + scroll={false}");
}

const pageTransition = readFileSync(join(root, "src/components/ios/IosNativePageTransition.tsx"), "utf8");
if (pageTransition.includes("getIosToolRouteIndex") && pageTransition.includes("AnimatePresence")) {
  ok("nav:direction-aware-page-transition");
} else {
  fail("nav:direction-aware-page-transition", "expected route-index transitions");
}
for (const [file, label] of sourceNeedles) {
  try {
    readFileSync(join(root, file), "utf8");
    ok(`file:${label}`, file);
  } catch {
    fail(`file:${label}`, `missing ${file}`);
  }
}
for (const [needle, label] of cssNeedles) {
  if (css.includes(needle)) ok(`css:${label}`, needle);
  else fail(`css:${label}`, `missing ${needle}`);
}

if (header.includes("showValues") && header.includes("hasQuote")) {
  ok("header:closed-session snapshot", "showValues when desk has quote");
} else {
  fail("header:closed-session snapshot", "expected hasQuote + showValues");
}

const nav = readFileSync(join(root, "src/components/Nav.tsx"), "utf8");
if (nav.includes("iosToolLabel") && nav.includes("getIosToolNavLabel")) {
  ok("nav:ios-tool-context-title");
} else {
  fail("nav:ios-tool-context-title", "expected centered tool title on iOS");
}

const siteLayout = readFileSync(join(root, "src/app/(site)/layout.tsx"), "utf8");
const spxDash = readFileSync(join(root, "src/components/SpxDashboard.tsx"), "utf8");
if (spxDash.includes("IosNativeSegment") && spxDash.includes("iosPanel")) {
  ok("spx:ios-panel-switcher");
} else {
  fail("spx:ios-panel-switcher", "expected IosNativeSegment panel switcher");
}

const flowFeed = readFileSync(join(root, "src/components/FlowFeed.tsx"), "utf8");
if (flowFeed.includes("iosView") && flowFeed.includes("helix-ios-toolbar")) {
  ok("helix:ios-view-switcher");
} else {
  fail("helix:ios-view-switcher", "expected tape/analytics switcher");
}

const nhFeed = readFileSync(join(root, "src/components/NightHawkFeed.tsx"), "utf8");
if (nhFeed.includes("iosView") && nhFeed.includes("playbook")) {
  ok("nighthawk:ios-view-switcher");
} else {
  fail("nighthawk:ios-view-switcher", "expected playbook/watch switcher");
}

if (siteLayout.includes("IosAppChrome")) {
  ok("layout:IosAppChrome-mounted");
} else {
  fail("layout:IosAppChrome-mounted", "expected IosAppChrome in site layout");
}

const toolRoutes = readFileSync(join(root, "src/lib/ios-tool-routes.ts"), "utf8");
if (toolRoutes.includes("isIosNativeShellRoute") && toolRoutes.includes("IOS_TOOLS")) {
  ok("routes:native-shell-metadata");
} else {
  fail("routes:native-shell-metadata", "expected IOS_TOOLS + isIosNativeShellRoute");
}

if (!header.includes('"— — —"')) {
  ok("header:no-triple-dash placeholder");
} else {
  fail("header:no-triple-dash placeholder", 'still renders "— — —"');
}

const dashboard = readFileSync(join(root, "src/app/(site)/dashboard/page.tsx"), "utf8");
if (!dashboard.includes('<main id="main">')) {
  ok("dashboard:no-nested-main");
} else {
  fail("dashboard:no-nested-main", "duplicate id=main breaks skip link");
}

const flowStream = readFileSync(join(root, "src/components/desk/FlowAlertStream.tsx"), "utf8");
if (flowStream.includes("flow-scroll-max") && !flowStream.includes("100vh - 210px")) {
  ok("helix:flow-tape-viewport");
} else {
  fail("helix:flow-tape-viewport", "expected flow-scroll-max without hardcoded 100vh");
}

const BASE = (process.env.VALIDATE_BASE || "https://blackouttrades.com").replace(/\/$/, "");

async function prodDeskSmoke() {
  const session = await mintClerkPremiumSession({ appUrl: BASE });
  if (session.skip) {
    console.log(`\n  [SKIP] prod desk API — ${session.reason}`);
    return;
  }

  console.log("\nvalidate:ios-mobile-desk — prod desk API smoke\n");

  try {
    const deskRes = await fetch(`${BASE}/api/market/spx/desk`, {
      headers: { Cookie: session.cookieHeader },
    });
    if (deskRes.status !== 200) {
      fail("api:spx/desk", `HTTP ${deskRes.status}`);
      return;
    }
    const desk = await deskRes.json();
    ok("api:spx/desk", `available=${desk.available} price=${desk.price ?? 0}`);

    if (desk.available && desk.price > 0) {
      ok("api:desk-has-quote", String(desk.price));
    } else {
      console.log("  [WARN] api:desk-has-quote — empty off-hours (UI will show honest empty state)");
    }
  } finally {
    await session.cleanup();
  }
}

await prodDeskSmoke();

const failed = checks.filter((c) => !c.pass);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
if (failed.length) process.exit(1);
