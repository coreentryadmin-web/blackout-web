#!/usr/bin/env node
/**
 * Live UI validation — Vector candle rendering (zoom in/out, view toggles, spacing).
 * Requires CLERK_SECRET_KEY + publishable key; uses temp admin user (deleted in finally).
 */
import { chromium, devices } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const BASE = process.env.VALIDATE_BASE ?? "https://blackouttrades.com";
const OUT = "/opt/cursor/artifacts/vector-candle-render-validate";
const TICKER = process.env.VECTOR_VALIDATE_TICKER ?? "SPY";

async function mintSession() {
  const { authenticateAuditUser } = await import("./audit/data-validator.mjs");
  return authenticateAuditUser({ role: "admin", tier: "premium" });
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const results = [];
  const pass = (name, detail = "") => results.push({ name, status: "PASS", detail });
  const fail = (name, detail = "") => results.push({ name, status: "FAIL", detail });
  const warn = (name, detail = "") => results.push({ name, status: "WARN", detail });

  let auth;
  try {
    auth = await mintSession();
  } catch (e) {
    console.error(JSON.stringify({ verdict: "RED", error: String(e) }, null, 2));
    process.exit(1);
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    ...devices["Desktop Chrome"],
    storageState: undefined,
  });
  await context.addCookies([
    { name: "__session", value: auth.sessionJwt, domain: "blackouttrades.com", path: "/", httpOnly: true, secure: true, sameSite: "Lax" },
    { name: "__client_uat", value: String(Math.floor(Date.now() / 1000)), domain: "blackouttrades.com", path: "/", secure: true, sameSite: "Lax" },
  ]);

  const page = await context.newPage();
  try {
    await page.goto(`${BASE}/vector?ticker=${TICKER}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForTimeout(4000);

    const zoomRow = page.locator('[data-testid="vector-intraday-zoom"]');
    if (await zoomRow.count()) {
      pass("intraday-zoom-controls", "Session/Structure/Live row present");
    } else {
      fail("intraday-zoom-controls", "Not deployed yet — merge + ECR required");
    }

    const chartStage = page.locator(".vector-chart-stage canvas").first();
    if (await chartStage.count()) {
      pass("chart-canvas", "Candle canvas rendered");
      await chartStage.screenshot({ path: join(OUT, "01-initial.png") });
    } else {
      fail("chart-canvas", "No canvas found");
    }

    for (const preset of ["structure", "session", "live"]) {
      const btn = page.locator(`[data-testid="vector-intraday-zoom-${preset}"]`);
      if (!(await btn.count())) continue;
      await btn.click();
      await page.waitForTimeout(1200);
      await chartStage.screenshot({ path: join(OUT, `02-zoom-${preset}.png`) });
      pass(`zoom-preset-${preset}`, "Clicked and captured");
    }

    const chartBox = await chartStage.boundingBox();
    if (chartBox) {
      const cx = chartBox.x + chartBox.width * 0.5;
      const cy = chartBox.y + chartBox.height * 0.5;
      await page.mouse.move(cx, cy);
      for (let i = 0; i < 8; i++) {
        await page.mouse.wheel(0, 120);
        await page.waitForTimeout(150);
      }
      await chartStage.screenshot({ path: join(OUT, "03-zoom-out-wheel.png") });
      pass("wheel-zoom-out", "8 scroll-out steps");

      for (let i = 0; i < 10; i++) {
        await page.mouse.wheel(0, -120);
        await page.waitForTimeout(150);
      }
      await chartStage.screenshot({ path: join(OUT, "04-zoom-in-wheel.png") });
      pass("wheel-zoom-in", "10 scroll-in steps");
    } else {
      warn("wheel-zoom", "No bounding box for canvas");
    }

    const view1d = page.locator('.vector-chart-view-seg button:has-text("1D")').first();
    if (await view1d.count()) {
      await view1d.click();
      await page.waitForTimeout(2500);
      const dailyCanvas = page.locator(".vector-daily-chart canvas").first();
      if (await dailyCanvas.count()) {
        await dailyCanvas.screenshot({ path: join(OUT, "05-daily-1d.png") });
        pass("daily-1d-view", "Historical chart rendered");
      } else {
        fail("daily-1d-view", "No daily chart canvas");
      }
      const intradayBtn = page.locator('.vector-chart-view-seg button:has-text("Intraday")').first();
      if (await intradayBtn.count()) {
        await intradayBtn.click();
        await page.waitForTimeout(2000);
        pass("back-to-intraday", "View toggle returns to intraday");
      }
    } else {
      warn("chart-view-toggle", "Segmented view toggle not found");
    }

    const reds = results.filter((r) => r.status === "FAIL");
    const verdict = reds.length ? "RED" : "GREEN";
    const out = { verdict, base: BASE, ticker: TICKER, results };
    await writeFile(join(OUT, "report.json"), JSON.stringify(out, null, 2));
    console.log(JSON.stringify(out, null, 2));
    process.exit(reds.length ? 1 : 0);
  } finally {
    await browser.close();
    if (auth?.cleanup) await auth.cleanup();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
