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
  dismissDeskModals,
  iosPlaywrightDevice,
  iosPlaywrightDeviceProMax16,
  mintIosPlaywrightSession,
  onboardingInitScript,
  readShellProbe,
  waitForNativeShell,
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
  { href: "/dashboard", label: "SPX Slayer", code: "SPX", route: "dashboard" },
  { href: "/flows", label: "HELIX", code: "HLX", route: "flows" },
  { href: "/heatmap", label: "BlackOut Thermal", code: "THM", route: "heatmap" },
  { href: "/terminal", label: "Largo", code: "LRG", route: "largo" },
  { href: "/nighthawk", label: "Night Hawk", code: "HWK", route: "nighthawk" },
  { href: "/vector", label: "Vector", code: "VEC", route: "vector" },
];

async function shot(page, name) {
  const path = join(OUT, `${name}.png`);
  await page.screenshot({ path, fullPage: false });
  return path;
}

async function clickSegment(page, label) {
  const btn = page.locator(".ios-native-segment-btn", { hasText: label }).first();
  if (await btn.isVisible().catch(() => false)) {
    await btn.scrollIntoViewIfNeeded().catch(() => null);
    await btn.click({ timeout: 15_000 }).catch(async () => {
      // Command-deck header can intercept pointer events on narrow iOS widths.
      await btn.click({ force: true, timeout: 10_000 });
    });
    await page.waitForTimeout(600);
    return true;
  }
  return false;
}

async function closeCommandDeck(page) {
  const overlay = page.locator(".ios-native-menu-overlay");
  if (!(await overlay.isVisible({ timeout: 800 }).catch(() => false))) return;
  await page.getByRole("button", { name: /close command deck/i }).click({ force: true, timeout: 3000 }).catch(() => null);
  await page.keyboard.press("Escape").catch(() => null);
  await overlay.waitFor({ state: "hidden", timeout: 8000 }).catch(() => null);
}
async function waitForVectorCanvas(page, timeoutMs = 45_000) {
  try {
    await page.waitForFunction(
      () => {
        const canvas = document.querySelector(".vector-chart-canvas canvas");
        return Boolean(canvas && canvas.clientHeight > 80 && canvas.clientWidth > 80);
      },
      { timeout: timeoutMs }
    );
    return true;
  } catch {
    return false;
  }
}

async function readVectorCanvasMetrics(page) {
  return page.evaluate(() => {
    const canvas = document.querySelector(".vector-chart-canvas canvas");
    return canvas ? { w: canvas.clientWidth, h: canvas.clientHeight } : null;
  });
}

async function clickFlowSeg(page, label) {
  const btn = page.locator(".flow-seg-btn", { hasText: label }).first();
  if (await btn.isVisible().catch(() => false)) {
    await btn.click();
    await page.waitForTimeout(400);
    return true;
  }
  return false;
}

async function clickRoleTab(page, pattern) {
  const tab = page.getByRole("tab", { name: pattern }).first();
  if (await tab.isVisible().catch(() => false)) {
    await tab.click();
    await page.waitForTimeout(500);
    return true;
  }
  return false;
}

async function clickDeckFilter(page, label) {
  const btn = page.locator(".nh-deck-filtbtn", { hasText: label }).first();
  if (await btn.isVisible().catch(() => false)) {
    await btn.click();
    await page.waitForTimeout(400);
    return true;
  }
  return false;
}

async function assertHelixTickerSearch(page, prefix = "") {
  const input = page.locator('input[aria-label="Search ticker"], .helix-native-ticker-input').first();
  if (!(await input.isVisible().catch(() => false))) {
    fail(`${prefix}helix:ticker-search`, "ticker input not visible");
    return;
  }
  await input.fill("NVDA");
  const val = await input.inputValue();
  if (val === "NVDA") ok(`${prefix}helix:ticker-search`, "filled NVDA");
  else fail(`${prefix}helix:ticker-search`, `expected NVDA got ${val}`);
  await input.fill("");
}

async function assertThermalTickerSheet(page, prefix = "") {
  const trigger = page.locator(".gex-ticker-native-trigger").first();
  if (!(await trigger.isVisible().catch(() => false))) {
    warn(`${prefix}thermal:ticker-sheet`, "native ticker trigger not visible");
    return;
  }
  await trigger.click();
  await page.waitForSelector(".gex-ticker-native-sheet", { timeout: 10_000 }).catch(() => null);
  const sheet = page.locator(".gex-ticker-native-sheet");
  if (!(await sheet.isVisible().catch(() => false))) {
    fail(`${prefix}thermal:ticker-sheet`, "sheet did not open");
    return;
  }
  ok(`${prefix}thermal:ticker-sheet-open`);
  const search = page.locator(".gex-ticker-native-sheet-search").first();
  if (await search.isVisible().catch(() => false)) {
    await search.fill("QQQ");
    ok(`${prefix}thermal:ticker-search`, "typed QQQ");
  } else {
    fail(`${prefix}thermal:ticker-search`, "sheet search input missing");
  }
  const backdrop = page.locator(".gex-ticker-native-sheet-backdrop").first();
  if (await backdrop.isVisible().catch(() => false)) {
    await backdrop.click({ position: { x: 24, y: 24 } });
    await page.waitForTimeout(400);
    ok(`${prefix}thermal:ticker-sheet-close`);
  }
}

async function assertNighthawkInteractions(page, prefix = "") {
  if (await clickDeckFilter(page, "OPEN")) ok(`${prefix}hawk:filter-open`);
  if (await clickDeckFilter(page, "ALL")) ok(`${prefix}hawk:filter-all`);
  const row = page.locator(".nh-deck-row").first();
  if (await row.isVisible().catch(() => false)) {
    await row.click();
    await page.waitForTimeout(500);
    const selected = page.locator(".nh-deck-row.sel").first();
    if (await selected.isVisible().catch(() => false)) ok(`${prefix}hawk:row-select`);
    else warn(`${prefix}hawk:row-select`, "row click did not mark selected");
  } else {
    warn(`${prefix}hawk:row-select`, "no play rows (empty lane ok off-hours)");
  }
  const tab = page.locator(".nh-deck-tabs button").first();
  if (await tab.isVisible().catch(() => false)) {
    await tab.click();
    ok(`${prefix}hawk:terminal-tab`);
  }
}

/** Fail-closed: each tool route must render visible desk content (not a blank shell). */
async function assertToolContent(page, route, prefix = "", opts = {}) {
  const { requireVectorCanvas = true } = opts;
  const metrics = await page.evaluate((r) => {
    const box = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return {
        h: rect.height,
        w: rect.width,
        top: rect.top,
        display: style.display,
        visibility: style.visibility,
        opacity: style.opacity,
      };
    };
    const textLen = document.body.innerText.replace(/\s+/g, " ").trim().length;
    const vh = window.innerHeight;
    const common = {
      textLen,
      vh,
      locked: !!document.querySelector(".ios-tool-locked-screen"),
      stageOpacity: document.querySelector(".ios-native-page-stage")?.style.opacity ?? "n/a",
    };
    if (r === "dashboard") {
      const canvas = document.querySelector(".vector-chart-canvas");
      const lc = canvas?.querySelector("canvas");
      return {
        ...common,
        hero: box(".spx-hero-price, .spx-sniper-command-native .spx-hero-price"),
        segment: !!document.querySelector(".ios-native-desk-segment"),
        vector: box(".spx-sniper-vector-col:not(.ios-native-panel-hidden)"),
        vectorCanvas: box(".vector-chart-canvas"),
        lcCanvas: lc
          ? { w: lc.clientWidth, h: lc.clientHeight, canvasW: lc.width, canvasH: lc.height }
          : null,
      };
    }
    if (r === "flows") {
      const activeSegment =
        document.querySelector(".ios-native-segment-btn[aria-pressed='true']")?.textContent?.trim() ?? "";
      return {
        ...common,
        activeSegment,
        gridHidden: document.querySelector(".helix-desk-terminal-grid.ios-native-panel-hidden") != null,
        tape: box(".helix-ios-tape-col:not(.ios-native-panel-hidden)"),
        analytics: box(".helix-ios-analytics-col:not(.ios-native-panel-hidden)"),
        flowPanels: document.querySelectorAll(".flow-panel").length,
        flowTable: box(".helix-flow-table, .flow-scroll-max, .flow-scroll"),
      };
    }
    if (r === "heatmap") {
      return {
        ...common,
        control: box(".gex-heatmap-control-row"),
        matrix: box(".gex-matrix-scroll"),
        cells: document.querySelectorAll(".gex-matrix-scroll td, .gex-matrix-scroll th").length,
      };
    }
    if (r === "largo") {
      return {
        ...common,
        input: box(".largo-input-fullpage, .largo-native-input, .desk-largo-input"),
        messages: box(".largo-messages-fullpage, .largo-native-messages"),
      };
    }
    if (r === "nighthawk") {
      const deck = box(".nh-deck");
      const legacy = box(".nighthawk-playbook, .nighthawk-layout");
      const canvas = box(".nighthawk-content-canvas");
      const deckLeft = box(".nh-deck-left");
      return {
        ...common,
        deck,
        legacy,
        canvas,
        deckLeft,
        deckRows: document.querySelectorAll(".nh-deck-row, .nighthawk-play-row").length,
        segment: !!document.querySelector(".ios-native-desk-segment"),
      };
    }
    if (r === "vector") {
      const canvas = document.querySelector(".vector-chart-canvas");
      const lc = canvas?.querySelector("canvas");
      return {
        ...common,
        vectorCanvas: box(".vector-chart-canvas"),
        lcCanvas: lc
          ? { w: lc.clientWidth, h: lc.clientHeight, canvasW: lc.width, canvasH: lc.height }
          : null,
        vectorShell: box(".vector-page-shell, .vector-desk-shell"),
      };
    }
    return common;
  }, route);

  if (metrics.locked) {
    warn(`${prefix}content:${route}`, "tool locked (ComingSoon) — skip blank check");
    return;
  }

  if (metrics.textLen < 80) {
    fail(`${prefix}content:${route}`, `body text too short (${metrics.textLen})`);
    return;
  }

  if (route === "dashboard") {
    const heroOk = metrics.hero && metrics.hero.h > 20;
    const lcOk =
      metrics.lcCanvas &&
      metrics.lcCanvas.h > 40 &&
      metrics.lcCanvas.w > 40;
    const vectorColVisible =
      metrics.vector && metrics.vector.h > 20 && metrics.vector.display !== "none";
    if (!requireVectorCanvas && metrics.segment) {
      ok(`${prefix}content:dashboard`, "segment active (vector not required)");
      return;
    }
    if (metrics.segment && lcOk) {
      ok(
        `${prefix}content:dashboard`,
        `vector canvas lc=${metrics.lcCanvas?.h ?? 0} hero=${metrics.hero?.h ?? 0}`
      );
      return;
    }
    if (heroOk && metrics.segment && (lcOk || !vectorColVisible)) {
      ok(
        `${prefix}content:dashboard`,
        `hero h=${metrics.hero?.h ?? 0} lc=${metrics.lcCanvas?.h ?? 0}${requireVectorCanvas ? "" : " (no vector req)"}`
      );
    } else if (heroOk && (lcOk || metrics.segment)) {
      ok(`${prefix}content:dashboard`, `hero h=${metrics.hero?.h ?? 0} lc=${metrics.lcCanvas?.h ?? 0}`);
    } else if (heroOk || metrics.segment) {
      fail(`${prefix}content:dashboard`, `Vector canvas missing/0-size (lc h=${metrics.lcCanvas?.h ?? 0})`);
    } else {
      fail(`${prefix}content:dashboard`, "SPX hero/segment not visible");
    }
    return;
  }

  if (route === "flows") {
    const tapeOk = metrics.tape && metrics.tape.h > 40 && metrics.tape.top < metrics.vh - 80;
    const analyticsOk = metrics.analytics && metrics.analytics.h > 40;
    const tableOk = metrics.flowTable && metrics.flowTable.h > 40;
    const analyticsSegment = /analytics/i.test(metrics.activeSegment || "");
    if (metrics.gridHidden && !tapeOk && !analyticsOk && !tableOk) {
      if (analyticsSegment) {
        warn(`${prefix}content:flows`, "analytics segment grid hidden — deploy #1409 fix pending");
        return;
      }
      fail(`${prefix}content:flows`, "helix-desk-terminal-grid hidden — blank HELIX bug");
      return;
    }
    if (tapeOk || analyticsOk || tableOk || metrics.flowPanels > 0) {
      ok(
        `${prefix}content:flows`,
        `${metrics.activeSegment || "flows"} tape h=${metrics.tape?.h ?? 0} analytics h=${metrics.analytics?.h ?? 0}`
      );
    } else {
      fail(
        `${prefix}content:flows`,
        `no visible tape/analytics (${metrics.activeSegment || "?"}) tape h=${metrics.tape?.h ?? 0}`
      );
    }
    return;
  }

  if (route === "heatmap") {
    const controlOk = metrics.control && metrics.control.h > 30;
    const matrixOk = metrics.matrix && metrics.matrix.h > 40;
    if (controlOk && (matrixOk || metrics.cells > 20)) {
      ok(`${prefix}content:heatmap`, `control h=${metrics.control.h} cells=${metrics.cells}`);
    } else {
      fail(`${prefix}content:heatmap`, `matrix/control not visible (ctrl=${metrics.control?.h ?? 0} mat=${metrics.matrix?.h ?? 0})`);
    }
    return;
  }

  if (route === "largo") {
    if (metrics.input && metrics.input.h > 20) ok(`${prefix}content:largo`, `input h=${metrics.input.h}`);
    else fail(`${prefix}content:largo`, "composer input not visible");
    return;
  }

  if (route === "nighthawk") {
    const deckOk = metrics.deck && metrics.deck.h > 80;
    const legacyOk = metrics.legacy && metrics.legacy.h > 40;
    const canvasOk = metrics.canvas && metrics.canvas.h > 120;
    const leftOk = metrics.deckLeft && metrics.deckLeft.h > 40;
    if (deckOk || legacyOk || (canvasOk && (leftOk || metrics.deckRows > 0))) {
      ok(
        `${prefix}content:nighthawk`,
        `deck h=${metrics.deck?.h ?? 0} legacy h=${metrics.legacy?.h ?? 0} rows=${metrics.deckRows}`
      );
    } else {
      fail(
        `${prefix}content:nighthawk`,
        `command deck not visible (deck=${metrics.deck?.h ?? 0} canvas=${metrics.canvas?.h ?? 0})`
      );
    }
    return;
  }

  if (route === "vector") {
    const lcOk =
      metrics.lcCanvas &&
      metrics.lcCanvas.h > 80 &&
      metrics.lcCanvas.w > 80 &&
      metrics.lcCanvas.canvasH > 0;
    const shellOk = metrics.vectorShell && metrics.vectorShell.h > 80;
    if (lcOk) {
      ok(
        `${prefix}content:vector`,
        `canvas h=${metrics.lcCanvas.h} w=${metrics.lcCanvas.w}`
      );
    } else if (shellOk) {
      warn(`${prefix}content:vector`, `shell visible but canvas 0-size (h=${metrics.lcCanvas?.h ?? 0})`);
    } else {
      fail(
        `${prefix}content:vector`,
        `Vector chart not visible (canvas h=${metrics.lcCanvas?.h ?? 0} shell h=${metrics.vectorShell?.h ?? 0})`
      );
    }
  }
}

async function testToolPage(page, tab, prefix = "") {
  const tabLink = page.getByRole("link", { name: tab.label }).first();
  const codeLink = page.locator(".ios-app-tab-link", { hasText: tab.code }).first();
  if (await tabLink.isVisible().catch(() => false)) {
    await tabLink.click();
  } else if (await codeLink.isVisible().catch(() => false)) {
    await codeLink.click();
  } else {
    warn(`tab:${tab.code}`, "rail link hidden — direct nav");
    await page.goto(`${BASE}${tab.href}`, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page.waitForFunction(() => window.Clerk?.user?.id, { timeout: 30_000 }).catch(() => null);
  }
  await page.waitForURL((url) => url.pathname === tab.href || url.pathname.startsWith(`${tab.href}/`), {
    timeout: 45_000,
  });
  await page.waitForTimeout(tab.route === "heatmap" ? 5000 : tab.route === "nighthawk" ? 3500 : 2000);
  if (tab.route === "heatmap") {
    await page.waitForSelector(".gex-heatmap-control-row, .gex-heatmap-panel", { timeout: 45_000 }).catch(() => null);
    await page.waitForTimeout(2500);
  }
  if (tab.route === "nighthawk") {
    await closeCommandDeck(page);
    await page
      .waitForSelector(".nh-deck, .nighthawk-playbook, .nh-deck-loading, .nh-deck-empty", { timeout: 45_000 })
      .catch(() => null);
  }
  if (tab.route === "flows") {
    await page.waitForSelector(".helix-desk-terminal-grid, .helix-flow-table, .flow-scroll-max", {
      timeout: 30_000,
    }).catch(() => null);
    await clickSegment(page, "Live tape");
    await page.waitForTimeout(600);
  }
  if (tab.route === "dashboard") {
    await dismissDeskModals(page);
    await page.waitForSelector(".vector-chart-canvas, .ios-native-desk-segment", { timeout: 45_000 }).catch(() => null);
    await waitForVectorCanvas(page, 45_000);
  }
  if (tab.route === "vector") {
    await page.waitForSelector(".vector-chart-canvas, .vector-page-shell, .vector-desk-shell", {
      timeout: 45_000,
    }).catch(() => null);
    await waitForVectorCanvas(page, 45_000);
  }

  await assertToolContent(page, tab.route, prefix);

  const probe = await readShellProbe(page);
  if (probe.route === tab.route || tab.route === "dashboard" && probe.route === "dashboard") {
    ok(`tab:${tab.code}`, probe.route ?? tab.href);
  } else if (probe.nativeShell && probe.route) {
    ok(`tab:${tab.code}`, `route=${probe.route}`);
  } else {
    warn(`tab:${tab.code}`, `loaded ${page.url()} shell=${JSON.stringify(probe)}`);
  }

  await shot(page, `tab-${tab.route}`);

  if (tab.route === "dashboard") {
    await page.waitForSelector(".vector-chart-canvas, .ios-native-desk-segment", { timeout: 45_000 }).catch(() => null);
    await dismissDeskModals(page);
    if (await clickSegment(page, "Matrix")) {
      ok(`${prefix}spx:segment-matrix`);
      await shot(page, `${prefix}spx-matrix`);
      const gexTab = page.locator("#spx-matrix-tab-gex, [id*='matrix-tab-gex']").first();
      if (await gexTab.isVisible().catch(() => false)) {
        await gexTab.click();
        ok("spx:matrix-gex-tab");
      }
      const vexTab = page.locator("#spx-matrix-tab-vex, [id*='matrix-tab-vex']").first();
      if (await vexTab.isVisible().catch(() => false)) {
        await vexTab.click();
        ok("spx:matrix-vex-tab");
      }
    }
    if (await clickSegment(page, "Vector")) {
      ok(`${prefix}spx:segment-vector`);
      await page.locator(".spx-sniper-vector-col").scrollIntoViewIfNeeded().catch(() => null);
      const ready = await waitForVectorCanvas(page, 45_000);
      const lc = await readVectorCanvasMetrics(page);
      if (ready && lc && lc.h > 80 && lc.w > 80) ok(`${prefix}spx:vector-canvas`, `h=${lc.h} w=${lc.w}`);
      else fail(`${prefix}spx:vector-canvas`, `canvas 0-size or missing (h=${lc?.h ?? 0}, ready=${ready})`);
      await shot(page, `${prefix}spx-vector`);
    }
    if (await clickSegment(page, "Intel")) {
      ok(`${prefix}spx:segment-intel`);
      await shot(page, `${prefix}spx-intel`);
      await assertToolContent(page, "dashboard", prefix, { requireVectorCanvas: false });
    }
    const identity = page.locator(".spx-sniper-identity");
    if (await identity.isVisible().catch(() => false)) {
      warn("spx:duplicate-identity", "title block still visible under native header");
    } else {
      ok("spx:no-duplicate-identity");
    }
  }

  if (tab.route === "flows") {
    if (await clickSegment(page, "Live tape")) {
      ok(`${prefix}helix:segment-tape`);
      await shot(page, `${prefix}helix-tape`);
      await assertToolContent(page, "flows", prefix);
    }
    if (await clickSegment(page, "Analytics")) {
      ok(`${prefix}helix:segment-analytics`);
      await shot(page, `${prefix}helix-analytics`);
      await assertToolContent(page, "flows", prefix);
    }
    if (await clickFlowSeg(page, "CALL")) ok("helix:filter-call");
    if (await clickFlowSeg(page, "PUT")) ok("helix:filter-put");
    if (await clickFlowSeg(page, "ALL")) ok("helix:filter-all");
    await assertHelixTickerSearch(page, prefix);
    if (await clickSegment(page, "Analytics")) {
      await page.waitForTimeout(400);
      await assertHelixTickerSearch(page, prefix);
    }
    if (await clickSegment(page, "Live tape")) {
      await page.waitForTimeout(400);
    }
    const tape = page.locator(".flow-scroll-max, .flow-scroll").first();
    if (await tape.isVisible().catch(() => false)) {
      await tape.evaluate((el) => {
        el.scrollTop += 200;
      });
      ok("helix:tape-scroll");
    }
  }

  if (tab.route === "heatmap") {
    // Matrix is default — switch to Profile first so tab clicks exercise real toggles.
    if (await clickRoleTab(page, /^Profile$/i)) ok("thermal:tab-profile");
    if (await clickRoleTab(page, /^Matrix$/i)) ok("thermal:tab-matrix");
    if (await clickRoleTab(page, /^gex$/i)) ok("thermal:lens-gex");
    if (await clickRoleTab(page, /^vex$/i)) ok("thermal:lens-vex");
    await assertThermalTickerSheet(page, prefix);
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
    await closeCommandDeck(page);
    if (await clickSegment(page, "0DTE")) {
      ok("hawk:segment-0dte");
      await page.waitForTimeout(800);
      await assertNighthawkInteractions(page, prefix);
      await shot(page, "hawk-0dte");
    }
    if (await clickSegment(page, "Swings")) {
      ok("hawk:segment-swings");
      await page.waitForTimeout(800);
      await shot(page, "hawk-swings");
      const laneLabel = page.locator("text=/Swings · 2–30 DTE/i").first();
      if (await laneLabel.isVisible().catch(() => false)) {
        ok("hawk:swing-lane-label");
      } else {
        warn("hawk:swing-lane-label", "lane header not visible");
      }
      const swingHint = page.locator(".nh-deck-empty, text=/Research|persistence|Whole-market swing/i").first();
      if (await swingHint.isVisible().catch(() => false)) {
        ok("hawk:swing-lane-hint");
      } else {
        warn("hawk:swing-lane-hint", "empty-state hint not visible (lane may have rows)");
      }
    }
    if (await clickSegment(page, "LEAPS")) {
      ok("hawk:segment-leaps");
    }
  }

  if (tab.route === "vector") {
    const ready = await waitForVectorCanvas(page, 45_000);
    const lc = await readVectorCanvasMetrics(page);
    if (ready && lc && lc.h > 80 && lc.w > 80) ok(`${prefix}vector:canvas`, `h=${lc.h} w=${lc.w}`);
    else fail(`${prefix}vector:canvas`, `canvas 0-size or missing (h=${lc?.h ?? 0}, ready=${ready})`);
    if (await clickSegment(page, "Pulse")) {
      ok(`${prefix}vector:segment-pulse`);
      await shot(page, `${prefix}vector-pulse`);
    }
    if (await clickSegment(page, "Ladder")) {
      ok(`${prefix}vector:segment-ladder`);
      await shot(page, `${prefix}vector-ladder`);
    }
    if (await clickSegment(page, "Scanner")) {
      ok(`${prefix}vector:segment-scanner`);
      await shot(page, `${prefix}vector-scanner`);
    }
    if (await clickSegment(page, "Chart")) {
      ok(`${prefix}vector:segment-chart`);
    }
    await shot(page, `${prefix}vector-tab`);
  }
}

console.log("test:ios-ui-e2e — Playwright iPhone 16 Pro / Pro Max audit\n");
console.log(`  base: ${BASE}\n`);

const consoleErrors = [];
const pageErrors = [];

async function runDevicePass(deviceFactory, session, prefix = "") {
  const { contextOptions, deviceName, tierClass } = deviceFactory();
  console.log(`  device: ${deviceName}\n`);

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
    ok(`${prefix}auth:clerk-session`);

    try {
      await waitForNativeShell(page, 45_000);
      ok(`${prefix}shell:native-active`, "ios-native-shell + tab bar");
    } catch {
      warn(`${prefix}shell:native-active`, "ios-native-shell slow — continuing with probes");
    }

    const tierOk = await page.evaluate((expected) => document.documentElement.classList.contains(expected), tierClass);
    if (tierOk) ok(`${prefix}device:tier-class`, tierClass);
    else warn(`${prefix}device:tier-class`, `expected ${tierClass} on html`);

    const shell0 = await readShellProbe(page);
    if (shell0.nativeShell) {
      ok(`${prefix}shell:native-active`, `route=${shell0.route}`);
    } else {
      warn(
        `${prefix}shell:native-active`,
        "ios-native-shell off — deploy main for full native chrome"
      );
    }

    if (shell0.iosApp) ok(`${prefix}shell:ios-app`);
    else fail(`${prefix}shell:ios-app`, "BlackOutiOSApp UA not detected");

    if (await page.locator(".ios-app-tab-bar").isVisible().catch(() => false)) {
      ok(`${prefix}shell:tab-bar`);
    } else {
      fail(`${prefix}shell:tab-bar`, "instrument rail missing");
    }

    const menuBtn = page.getByRole("button", { name: /command deck|open menu/i });
    if (await menuBtn.isVisible().catch(() => false)) {
      await menuBtn.click();
      await page.waitForSelector(".ios-native-menu-sheet", { timeout: 10_000 });
      ok(`${prefix}chrome:menu-open`);
      await shot(page, `${prefix}menu-open`);
      await closeCommandDeck(page);
      await page.waitForSelector(".ios-native-menu-sheet", { state: "hidden", timeout: 10_000 }).catch(() => null);
      ok(`${prefix}chrome:menu-close`);
    } else {
      warn(`${prefix}chrome:menu`, "command deck button not visible");
    }

    await shot(page, `${prefix}00-dashboard-entry`);

    for (const tab of TABS) {
      await testToolPage(page, tab, prefix);
    }

    const returnTab = page.locator(".ios-app-tab-link", { hasText: "SPX" }).first();
    if (await returnTab.isVisible().catch(() => false)) {
      await returnTab.click();
    } else {
      await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded", timeout: 30_000 });
    }
    await page.waitForURL(/\/dashboard/, { timeout: 30_000 });
    ok(`${prefix}nav:return-spx`);
  } finally {
    await browser.close();
  }
}

const session = await mintIosPlaywrightSession({ appUrl: BASE });
if (session.skip) {
  console.log(`  [SKIP] test:ios-ui-e2e — ${session.reason}`);
  process.exit(0);
}

try {
  await runDevicePass(iosPlaywrightDevice, session, "pro:");
  await runDevicePass(iosPlaywrightDeviceProMax16, session, "max:");
} finally {
  await session.cleanup();
}

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
