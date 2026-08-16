#!/usr/bin/env node
/**
 * Prod screenshot — Vector bead rail Events toggle + hover tooltip.
 * Requires CLERK_SECRET_KEY + NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY.
 * Output → /opt/cursor/artifacts/vector-events/
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import {
  mintIosPlaywrightSession,
  onboardingInitScript,
} from "./audit/lib/ios-playwright-auth.mjs";

const BASE = (process.env.CRON_TARGET_BASE_URL ?? "https://blackouttrades.com").replace(/\/$/, "");
const ART = "/opt/cursor/artifacts/vector-events";
const TICKER = process.env.VECTOR_SCREENSHOT_TICKER || "SPX";

fs.mkdirSync(ART, { recursive: true });

console.log(`\n=== Vector Events screenshot (${BASE}) ===\n`);

const session = await mintIosPlaywrightSession({ appUrl: BASE });
if (session.skip) {
  console.error("Auth skip:", session.reason);
  process.exit(1);
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1600, height: 1000 },
});
await context.addCookies(session.cookies);
await context.addInitScript(onboardingInitScript());
const page = await context.newPage();

try {
  for (const route of [`${BASE}/vector?ticker=${TICKER}`, `${BASE}/dashboard`]) {
    console.log(`Navigating → ${route}`);
    await page.goto(route, { waitUntil: "domcontentloaded", timeout: 120_000 });
    await page.waitForTimeout(6000);

    const hasCanvas =
      (await page.locator(".vector-chart-canvas canvas, .vector-chart-stage canvas").count()) > 0;
    if (!hasCanvas) {
      await page.screenshot({
        path: path.join(ART, `skip-${route.includes("dashboard") ? "dashboard" : "vector"}.png`),
        fullPage: false,
      });
      console.log(`  no chart on ${route}`);
      continue;
    }

    const eventsBtn = page.locator('[data-testid="vector-bead-bead-event-glyphs"]').first();
    if ((await eventsBtn.count()) === 0) {
      console.log(`  no Events chip on ${route}`);
      continue;
    }

    const eventsOn = (await eventsBtn.getAttribute("aria-pressed")) === "true";
    console.log(`Events toggle aria-pressed=${eventsOn}`);
    if (!eventsOn) {
      await eventsBtn.click();
      await page.waitForTimeout(800);
    }

    await page.screenshot({
      path: path.join(ART, "01-vector-events-chart.png"),
      fullPage: false,
    });
    console.log(`✓ Saved ${ART}/01-vector-events-chart.png`);

    const seg = page.locator(".vector-bead-rail-seg").first();
    if (await seg.isVisible().catch(() => false)) {
      await seg.screenshot({ path: path.join(ART, "02-events-toggle-chips.png") }).catch(() => {});
      if (fs.existsSync(path.join(ART, "02-events-toggle-chips.png"))) {
        console.log(`✓ Saved ${ART}/02-events-toggle-chips.png`);
      }
    } else {
      console.log("  bead rail seg not visible — using full chart crop");
    }

    const canvas = page.locator(".vector-chart-canvas canvas, .vector-chart-stage canvas").first();
    const box = await canvas.boundingBox();
    if (box) {
      const hoverPoints = [
        { x: box.x + box.width * 0.32, y: box.y + box.height * 0.4 },
        { x: box.x + box.width * 0.42, y: box.y + box.height * 0.52 },
        { x: box.x + box.width * 0.25, y: box.y + box.height * 0.36 },
        { x: box.x + box.width * 0.55, y: box.y + box.height * 0.45 },
        { x: box.x + box.width * 0.38, y: box.y + box.height * 0.62 },
      ];
      for (const pt of hoverPoints) {
        await page.mouse.move(pt.x, pt.y);
        await page.waitForTimeout(700);
        const tooltip = page.locator('[role="tooltip"]');
        if (await tooltip.isVisible().catch(() => false)) {
          const text = await tooltip.innerText().catch(() => "");
          await page.screenshot({
            path: path.join(ART, "03-event-hover-tooltip.png"),
            fullPage: false,
          });
          console.log(`✓ Tooltip: "${text.slice(0, 100)}"`);
          break;
        }
      }
    }

    console.log("\nGREEN — screenshots saved to", ART);
    break;
  }
} catch (err) {
  await page.screenshot({ path: path.join(ART, "error.png"), fullPage: false }).catch(() => {});
  console.error("FAIL:", err?.message || err);
  process.exitCode = 1;
} finally {
  await browser.close();
  await session.cleanup?.();
}
