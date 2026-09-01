#!/usr/bin/env node
/**
 * Live Vector viewport + volume-pane visibility probe.
 * Usage: node scripts/audit/vector-viewport-live-check.mjs [--base=...] [--ticker=NVDA] [--width=1920] [--height=1080]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { mintIosPlaywrightSession, onboardingInitScript } from "./lib/ios-playwright-auth.mjs";

const baseArg = process.argv.find((a) => a.startsWith("--base="));
const BASE = (baseArg ? baseArg.slice(7) : "https://blackouttrades.com").replace(/\/$/, "");
const ticker = (process.argv.find((a) => a.startsWith("--ticker="))?.slice(9) ?? "NVDA").toUpperCase();
const width = Number(process.argv.find((a) => a.startsWith("--width="))?.slice(8) ?? 1920);
const height = Number(process.argv.find((a) => a.startsWith("--height="))?.slice(9) ?? 1080);
const OUT = "/opt/cursor/artifacts/vector-viewport-check";
mkdirSync(OUT, { recursive: true });

const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

async function main() {
  const pw = await mintIosPlaywrightSession({ appUrl: BASE });
  if (pw.skip) {
    console.error("AUTH SKIP:", pw.reason);
    process.exit(2);
  }

  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const context = await browser.newContext({ userAgent: UA, viewport: { width, height } });
  await context.addInitScript(onboardingInitScript());
  await context.addCookies(pw.cookies);
  const page = await context.newPage();

  try {
    await page.goto(`${BASE}/vector?ticker=${ticker}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
    await page.locator(".vector-chart-wrap").waitFor({ state: "visible", timeout: 90_000 });
    await page.waitForTimeout(5000);

    const metrics = await page.evaluate(() => {
      const shell = document.querySelector(".vector-page-shell");
      const grid = document.querySelector(".vector-chart-terminal-grid");
      const chartCol = document.querySelector(".vector-chart-terminal-chart");
      const canvas = document.querySelector(".vector-chart-canvas");
      const stage = document.querySelector(".vector-chart-stage");
      const wrap = document.querySelector(".vector-chart-wrap");

      const rect = (el) => {
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height), w: Math.round(r.width) };
      };

      // lightweight-charts: each pane is a table row; volume is the histogram row (pane index 1).
      const chartTable = canvas?.querySelector("table");
      const paneRows = chartTable ? [...chartTable.querySelectorAll("tr")] : [];
      const paneMetrics = paneRows.map((row, i) => {
        const r = row.getBoundingClientRect();
        const canv = row.querySelector("canvas");
        const cr = canv?.getBoundingClientRect();
        const inViewport = cr ? cr.bottom <= window.innerHeight + 2 && cr.top >= 0 : false;
        return {
          pane: i,
          rowH: Math.round(r.height),
          canvasH: cr ? Math.round(cr.height) : 0,
          bottom: Math.round(r.bottom),
          inViewport,
        };
      });

      // Volume pane = first row after price with meaningful canvas height (histogram strip).
      const volumePane =
        paneMetrics.find((p, i) => i > 0 && p.canvasH >= 40) ??
        paneMetrics.find((p, i) => i > 0 && p.rowH >= 40);

      const shellStyle = shell ? getComputedStyle(shell) : null;
      const gridStyle = grid ? getComputedStyle(grid) : null;

      return {
        viewport: { w: window.innerWidth, h: window.innerHeight },
        scrollH: document.documentElement.scrollHeight,
        scrollOverflow: document.documentElement.scrollHeight - window.innerHeight,
        shell: rect(shell),
        grid: rect(grid),
        chartCol: rect(chartCol),
        wrap: rect(wrap),
        stage: rect(stage),
        canvas: rect(canvas),
        paneMetrics,
        shellHeight: shellStyle?.height,
        gridTemplateRows: gridStyle?.gridTemplateRows,
        gridCols: gridStyle?.gridTemplateColumns,
        volumePane,
      };
    });

    const ts = Date.now();
    const shotViewport = join(OUT, `vector-${ticker}-${width}x${height}-${ts}.png`);
    const shotFull = join(OUT, `vector-${ticker}-${width}x${height}-full-${ts}.png`);
    await page.screenshot({ path: shotViewport, fullPage: false });
    await page.screenshot({ path: shotFull, fullPage: true });

    const report = { ticker, width, height, metrics, shots: { viewport: shotViewport, fullPage: shotFull } };
    writeFileSync(join(OUT, `report-${ts}.json`), JSON.stringify(report, null, 2));

    console.log(JSON.stringify(report, null, 2));

    const pageOk = Math.abs(metrics.scrollOverflow) <= 2;
    const volumePane = metrics.volumePane;
    const shellBottomOk = metrics.shell && metrics.shell.bottom >= metrics.viewport.h - 2;
    const chartBottomOk =
      metrics.canvas && metrics.canvas.bottom <= metrics.viewport.h + 2;
    const volumeOk = volumePane && volumePane.inViewport && volumePane.canvasH >= 40;

    if (!pageOk) {
      console.error(`FAIL page scroll overflow: ${metrics.scrollOverflow}px`);
      process.exit(1);
    }
    if (!shellBottomOk) {
      console.error(`FAIL shell does not reach viewport bottom:`, metrics.shell);
      process.exit(1);
    }
    if (!chartBottomOk) {
      console.error(`FAIL chart clipped below viewport:`, metrics.canvas);
      process.exit(1);
    }
    if (!volumeOk) {
      console.error(`FAIL volume pane not fully visible:`, volumePane, metrics.paneMetrics);
      process.exit(1);
    }
    console.log("PASS viewport fit + volume pane visible");
  } finally {
    await browser.close();
    await pw.cleanup?.();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
