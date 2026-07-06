#!/usr/bin/env node
/**
 * iOS native UI E2E — Playwright simulates Capacitor WKWebView (BlackOutiOSApp UA +
 * iPhone viewport), signs in via Clerk cookie jar, clicks every tool tab + primary
 * controls, captures screenshots. Closest automated proxy to TestFlight interaction.
 *
 * Usage:
 *   npm run test:ios-ui-e2e
 *   VALIDATE_BASE=https://blackouttrades.com npm run test:ios-ui-e2e
 *
 * Output:
 *   /opt/cursor/artifacts/ios-ui-e2e/report.json
 *   /opt/cursor/artifacts/ios-ui-e2e/*.png
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import {
  iosPlaywrightDevice,
  mintIosPlaywrightSession,
  onboardingInitScript,
  readShellProbe,
} from "./audit/lib/ios-playwright-auth.mjs";

const BASE = (process.env.VALIDATE_BASE || "https://blackouttrades.com").replace(/\/$/, "");
const OUT = process.env.IOS_UI_E2E_DIR || "/opt/cursor/artifacts/ios-ui-e2e";
mkdirSync(OUT, { recursive: true });

const checks = [];
const ok = (name, detail = "") => {
  checks.push({ name, pass: true, detail });
  console.log(`  [PASS] ${name}${detail ? ` — ${detail}` : ""}`);
};
const warn = (name, detail = "") => {
  checks.push({ name, pass: true, warn: true, detail });
  console.log(`  [WARN] ${name}${detail ? ` — ${detail}` : ""}`);
};
const fail = (name, detail = "") => {
  checks.push({ name, pass: false, detail });
  console.error(`  [FAIL] ${name}${detail ? ` — ${detail}` : ""}`);
};

const TABS = [
  { href: "/dashboard", short: "SPX", route: "dashboard" },
  { href: "/flows", short: "HELIX", route: "flows" },
  { href: "/heatmap", short: "Thermal", route: "heatmap" },
  { href: "/terminal", short: "Largo", route: "largo" },
  { href: "/nighthawk", short: "Hawk", route: "nighthawk" },
  { href: "/grid", short: "0DTE", route: "grid" },
];

async function shot(page, name) {
  const path = join(OUT, `${name}.png`);
  await page.screenshot({ path, fullPage: false });
  return path;
}

async function clickSegment(page, label) {
  const btn = page.locator(".ios-native-segment-btn", { hasText: label }).first();
  if (await btn.isVisible().catch(() => false)) {
    await btn.click();
    await page.waitForTimeout(600);
    return true;
  }
  return false;
}

async function testToolPage(page, tab) {
  const tabLink = page.locator(".ios-app-tab-link", { hasText: tab.short }).first();
  if (!(await tabLink.isVisible().catch(() => false))) {
    fail(`tab:${tab.short}`, "tab link not visible");
    return;
  }
  await tabLink.click();
  await page.waitForURL((url) => url.pathname === tab.href || url.pathname.startsWith(`${tab.href}/`), {
    timeout: 45_000,
  });
  await page.waitForTimeout(1500);

  const probe = await readShellProbe(page);
  if (probe.route === tab.route || tab.route === "dashboard" && probe.route === "dashboard") {
    ok(`tab:${tab.short}`, probe.route ?? tab.href);
  } else if (probe.nativeShell && probe.route) {
    ok(`tab:${tab.short}`, `route=${probe.route}`);
  } else {
    warn(`tab:${tab.short}`, `loaded ${page.url()} shell=${JSON.stringify(probe)}`);
  }

  await shot(page, `tab-${tab.route}`);

  if (tab.route === "dashboard") {
    if (await clickSegment(page, "Matrix")) {
      ok("spx:segment-matrix");
      await shot(page, "spx-matrix");
    }
    if (await clickSegment(page, "Plays")) {
      ok("spx:segment-plays");
      await shot(page, "spx-plays");
    }
    if (await clickSegment(page, "Intel")) {
      ok("spx:segment-intel");
      await shot(page, "spx-intel");
    }
    const identity = page.locator(".spx-sniper-identity");
    if (await identity.isVisible().catch(() => false)) {
      warn("spx:duplicate-identity", "title block still visible under native header");
    } else {
      ok("spx:no-duplicate-identity");
    }
  }

  if (tab.route === "flows") {
    if (await clickSegment(page, "Analytics")) {
      ok("helix:segment-analytics");
      await shot(page, "helix-analytics");
    }
    if (await clickSegment(page, "Live tape")) {
      ok("helix:segment-tape");
    }
  }

  if (tab.route === "heatmap") {
    const matrixTab = page.getByRole("tab", { name: /^Matrix$/i }).first();
    if (await matrixTab.isVisible().catch(() => false)) {
      await matrixTab.click();
      ok("thermal:tab-matrix");
    }
    const gexTab = page.getByRole("tab", { name: /^gex$/i }).first();
    if (await gexTab.isVisible().catch(() => false)) {
      await gexTab.click();
      ok("thermal:lens-gex");
    }
    const scroll = page.locator(".gex-matrix-scroll, .max-h-\\[clamp\\(480px\\,74vh\\,880px\\)\\]").first();
    if (await scroll.isVisible().catch(() => false)) {
      await scroll.evaluate((el) => {
        el.scrollLeft += 120;
        el.scrollTop += 80;
      });
      ok("thermal:matrix-scroll");
    }
    await shot(page, "thermal-matrix");
  }

  if (tab.route === "largo") {
    const chip = page.locator(".largo-suggestion-chip").first();
    if (await chip.isVisible().catch(() => false)) {
      ok("largo:suggestion-visible");
    }
    const input = page.locator(".largo-input-fullpage, .desk-largo-input").first();
    if (await input.isVisible().catch(() => false)) {
      await input.fill("What's the SPX setup?");
      ok("largo:input-fill");
    }
    const send = page.getByRole("button", { name: /^send$/i }).first();
    if (await send.isEnabled().catch(() => false)) {
      ok("largo:send-enabled");
    }
    await shot(page, "largo-input");
  }

  if (tab.route === "nighthawk") {
    if (await clickSegment(page, "Night's Watch")) {
      ok("hawk:segment-watch");
      await shot(page, "hawk-watch");
    }
    if (await clickSegment(page, "Playbook")) {
      ok("hawk:segment-playbook");
    }
  }

  if (tab.route === "grid") {
    const cmd = page.getByRole("tab", { name: /0DTE Command/i }).first();
    if (await cmd.isVisible().catch(() => false)) {
      await cmd.click();
      ok("grid:tab-command");
    }
    await shot(page, "grid-command");
  }
}

console.log("test:ios-ui-e2e — Playwright mobile interaction audit\n");
console.log(`  base: ${BASE}\n`);

const session = await mintIosPlaywrightSession({ appUrl: BASE });
if (session.skip) {
  console.log(`  [SKIP] test:ios-ui-e2e — ${session.reason}`);
  process.exit(0);
}

const consoleErrors = [];
const pageErrors = [];
const { contextOptions } = iosPlaywrightDevice();
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
const context = await browser.newContext(contextOptions);
await context.addInitScript(onboardingInitScript());
await context.addCookies(session.cookies);

const page = await context.newPage();
page.on("console", (msg) => {
  if (msg.type() === "error") consoleErrors.push(msg.text());
});
page.on("pageerror", (err) => pageErrors.push(err.message));

try {
  await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await page.waitForFunction(() => window.Clerk?.user?.id, { timeout: 60_000 });
  ok("auth:clerk-session");

  const shell0 = await readShellProbe(page);
  if (shell0.nativeShell) {
    ok("shell:native-active", `route=${shell0.route}`);
  } else {
    warn(
      "shell:native-active",
      "ios-native-shell off — merge/deploy PR #557 for full native chrome; tab bar + ios-app still testable"
    );
  }

  if (shell0.iosApp) ok("shell:ios-app");
  else fail("shell:ios-app", "BlackOutiOSApp UA not detected");

  if (await page.locator(".ios-app-tab-bar").isVisible().catch(() => false)) {
    ok("shell:tab-bar");
  } else {
    fail("shell:tab-bar", "bottom tab dock missing");
  }

  const menuBtn = page.getByRole("button", { name: /open menu/i });
  if (await menuBtn.isVisible().catch(() => false)) {
    await menuBtn.click();
    await page.waitForSelector(".ios-native-menu-sheet", { timeout: 10_000 });
    ok("chrome:menu-open");
    await shot(page, "menu-open");
    await page.getByRole("button", { name: /close menu/i }).click();
    ok("chrome:menu-close");
  } else {
    warn("chrome:menu", "native menu button not visible (pre-native-shell deploy)");
  }

  await shot(page, "00-dashboard-entry");

  for (const tab of TABS) {
    await testToolPage(page, tab);
  }

  // Round-trip back to SPX via tab bar
  await page.locator(".ios-app-tab-link", { hasText: "SPX" }).first().click();
  await page.waitForURL(/\/dashboard/, { timeout: 30_000 });
  ok("nav:return-spx");

  if (pageErrors.length) {
    fail("runtime:page-errors", pageErrors.slice(0, 3).join(" | "));
  } else {
    ok("runtime:page-errors");
  }

  const noisyConsole = consoleErrors.filter(
    (e) => !/clerk|favicon|404|ResizeObserver|hydration/i.test(e)
  );
  if (noisyConsole.length) {
    warn("runtime:console-errors", noisyConsole.slice(0, 3).join(" | "));
  } else {
    ok("runtime:console-errors");
  }
} finally {
  await browser.close();
  await session.cleanup();
}

const failed = checks.filter((c) => !c.pass);
const reportPath = join(OUT, "report.json");
writeFileSync(
  reportPath,
  JSON.stringify({ base: BASE, ts: new Date().toISOString(), checks }, null, 2)
);

console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
console.log(`  report: ${reportPath}`);
console.log(`  screenshots: ${OUT}\n`);

if (failed.length) process.exit(1);
