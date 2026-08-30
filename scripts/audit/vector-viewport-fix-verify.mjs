#!/usr/bin/env node
/** Inject the viewport-fit CSS on live prod and verify layout improves. */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { mintIosPlaywrightSession, onboardingInitScript } from "./lib/ios-playwright-auth.mjs";

const BASE = "https://blackouttrades.com";
const OUT = "/opt/cursor/artifacts/vector-viewport-check";
mkdirSync(OUT, { recursive: true });

const FIX_CSS = `
@media (min-width: 1280px) {
  html:not(.ios-native-shell) .vector-page-shell:not(:has(.vector-page-content-focus)) {
    height: 100dvh !important;
    max-height: 100dvh !important;
    min-height: 100dvh !important;
  }
  .vector-page-shell .vector-chart-terminal-grid {
    min-height: 0 !important;
  }
}
`;

async function metrics(page) {
  return page.evaluate(() => {
    const shell = document.querySelector(".vector-page-shell");
    const canvas = document.querySelector(".vector-chart-canvas");
    const rect = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height) };
    };
    const table = canvas?.querySelector("table");
    const rows = table ? [...table.querySelectorAll("tr")] : [];
    const volumePane = rows
      .map((row, i) => {
        const cr = row.querySelector("canvas")?.getBoundingClientRect();
        return {
          pane: i,
          canvasH: cr ? Math.round(cr.height) : 0,
          bottom: cr ? Math.round(cr.bottom) : 0,
          inViewport: cr ? cr.bottom <= window.innerHeight + 2 && cr.height >= 40 : false,
        };
      })
      .find((p, i) => i > 0 && p.canvasH >= 40);
    return {
      innerH: window.innerHeight,
      scrollOverflow: document.documentElement.scrollHeight - window.innerHeight,
      shell: rect(shell),
      canvas: rect(canvas),
      volumePane,
    };
  });
}

async function main() {
  const pw = await mintIosPlaywrightSession({ appUrl: BASE });
  if (pw.skip) throw new Error(pw.reason);
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  await context.addInitScript(onboardingInitScript());
  await context.addCookies(pw.cookies);
  const page = await context.newPage();
  try {
    await page.goto(`${BASE}/vector?ticker=NVDA`, { waitUntil: "domcontentloaded", timeout: 120_000 });
    await page.locator(".vector-chart-wrap").waitFor({ timeout: 90_000 });
    await page.waitForTimeout(5000);
    const before = await metrics(page);
    await page.screenshot({ path: join(OUT, "vector-after-fix-injected-before.png") });
    await page.addStyleTag({ content: FIX_CSS });
    await page.waitForTimeout(1500);
    // nudge chart resize
    await page.evaluate(() => window.dispatchEvent(new Event("resize")));
    await page.waitForTimeout(1500);
    const after = await metrics(page);
    await page.screenshot({ path: join(OUT, "vector-after-fix-injected-after.png") });
    const report = { before, after };
    writeFileSync(join(OUT, "fix-verify-report.json"), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
    const ok =
      after.shell?.bottom >= after.innerH - 2 &&
      after.canvas?.bottom <= after.innerH + 2 &&
      after.volumePane?.inViewport;
    if (!ok) process.exit(1);
    console.log("PASS injected CSS fix verified on live prod");
  } finally {
    await browser.close();
    await pw.cleanup?.();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
