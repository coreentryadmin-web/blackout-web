#!/usr/bin/env node
/** Capture Trade manager read + narrative bullets on live prod after v4 deploy.
 *
 * Uses createTunneledContext (CONNECT tunnel) — Chromium has no direct network in this sandbox.
 * Run from repo root: NODE_USE_ENV_PROXY=1 node scripts/audit/ask-largo-v4-screenshots.mjs
 */
import { mkdir, writeFile } from "node:fs/promises";
import { mintClerkPremiumSession } from "./lib/prod-clerk-session.mjs";
import { createPlaywrightAuditContext } from "./lib/playwright-audit-context.mjs";

const BASE = (process.env.VALIDATE_BASE || "https://blackouttrades.com").replace(/\/$/, "");
const OUT = process.env.SCREENSHOT_OUT || "/opt/cursor/artifacts/ask-largo-v4-deployed";

async function main() {
  await mkdir(OUT, { recursive: true });
  const session = await mintClerkPremiumSession({
    appUrl: BASE,
    publicMetadata: { role: "admin", tier: "premium" },
  });
  if (session.skip) {
    console.error("SKIP:", session.reason);
    process.exit(2);
  }

  const { browser, ctx, counts, mode } = await createPlaywrightAuditContext({
    url: BASE,
    cookie: session.cookieHeader,
    viewport: "1680x1050",
    desktop: true,
    requestTimeoutMs: 60_000,
  });
  const page = await ctx.newPage();

  await page.goto(`${BASE}/nighthawk?view=swings`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.waitForTimeout(4000);

  const bar = page.locator('.nh-deck-filterbar[aria-label="Filter plays by status"]');
  await bar.locator(".nh-deck-filtbtn").filter({ hasText: /^OPEN\b/i }).click();
  await page.waitForTimeout(1200);
  await page.locator(".nh-deck-rows .nh-deck-row").first().click();
  await page.waitForTimeout(3000);

  // Full desk
  await page.screenshot({ path: `${OUT}/open-v4-full-desk.png` });

  // Scroll Trade manager read into view inside Largo panel
  const largo = page.locator(".nh-deck-largo--brief");
  const tradeMgr = page.locator(".bie-answer__section-title, .nh-deck-largo__bie h3, .nh-deck-largo__bie h4").filter({ hasText: /Trade manager read/i });
  if (await tradeMgr.count()) {
    await tradeMgr.first().scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);
  }
  const box = await largo.boundingBox();
  if (box) {
    await page.screenshot({
      path: `${OUT}/open-v4-trade-manager-read.png`,
      clip: {
        x: Math.max(0, box.x - 8),
        y: Math.max(0, box.y - 8),
        width: Math.min(1680, box.width + 16),
        height: Math.min(1050, box.height + 16),
      },
    });
  }

  // Scroll within bie body to show folded footnote at bottom of narrative
  await page.evaluate(() => {
    const el = document.querySelector(".nh-deck-largo__bie-body, .bie-answer__body");
    if (el) el.scrollTop = el.scrollHeight;
  });
  await page.waitForTimeout(400);
  if (box) {
    await page.screenshot({
      path: `${OUT}/open-v4-narrative-footnote.png`,
      clip: {
        x: Math.max(0, box.x - 8),
        y: Math.max(0, box.y - 8),
        width: Math.min(1680, box.width + 16),
        height: Math.min(1050, box.height + 16),
      },
    });
  }

  // CLOSED tab
  await bar.locator(".nh-deck-filtbtn").filter({ hasText: /^CLOSED\b/i }).click();
  await page.waitForTimeout(1200);
  await page.locator(".nh-deck-rows .nh-deck-row").first().click();
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `${OUT}/closed-v4-full-desk.png` });
  const closedLargo = page.locator(".nh-deck-largo--brief");
  const cbox = await closedLargo.boundingBox();
  if (cbox) {
    await page.screenshot({
      path: `${OUT}/closed-v4-ask-largo-crop.png`,
      clip: { x: cbox.x, y: cbox.y, width: cbox.width, height: cbox.height },
    });
  }

  const probe = await page.evaluate(async () => {
    const res = await fetch(
      "/api/market/swing/play-brief?playId=SWING%3ANRG%3A34&ticker=NRG&positionId=34&status=HOLD&strike=110&right=C",
      { credentials: "same-origin" },
    );
    const json = await res.json();
    const narrative = json.envelope?.sections?.find((s) => s.title === "Trade manager read");
    return {
      sections: json.envelope?.sections?.map((s) => s.title) ?? [],
      narrativeSnippet: (narrative?.body ?? "").slice(0, 1200),
      briefContentKey: json.briefContentKey ?? null,
    };
  });

  const report = { capturedAt: new Date().toISOString(), base: BASE, routed: counts, mode, probe };
  await writeFile(`${OUT}/v4-screenshot-report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));

  await browser.close();
  await session.cleanup();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
