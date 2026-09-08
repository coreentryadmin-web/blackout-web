#!/usr/bin/env node
/** Capture Ask Largo swing play brief on live Swings desk. */
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import { mintClerkPremiumSession } from "./lib/prod-clerk-session.mjs";
import { resolveChromiumPath } from "./lib/playwright-chromium-path.mjs";

const BASE = (process.env.VALIDATE_BASE || "https://blackouttrades.com").replace(/\/$/, "");
const OUT = process.env.SCREENSHOT_OUT || "/opt/cursor/artifacts/ask-largo-swing-brief-20260905";

function cookiesFromHeader(header, domain) {
  return header
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((p) => {
      const [n, ...r] = p.split("=");
      const name = n.trim();
      return {
        name,
        value: r.join("=").trim(),
        domain,
        path: "/",
        httpOnly: name === "__session",
        secure: domain !== "localhost",
        sameSite: "Lax",
      };
    });
}

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

  const execPath = resolveChromiumPath();
  const browser = await chromium.launch({
    headless: true,
    executablePath: execPath,
    args: ["--no-sandbox"],
  });
  const host = new URL(BASE).hostname;
  const ctx = await browser.newContext({ viewport: { width: 1680, height: 1050 }, deviceScaleFactor: 1.5 });
  await ctx.addCookies(cookiesFromHeader(session.cookieHeader, host));
  const page = await ctx.newPage();
  const captured = [];

  await page.goto(`${BASE}/nighthawk?view=swings`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.waitForTimeout(5000);

  const emptyLargo = page.locator(".nh-deck-largo-empty");
  if (await emptyLargo.count()) {
    captured.push(`${OUT}/01-swings-list-empty-largo.png`);
    await page.screenshot({ path: captured.at(-1), fullPage: false });
  }

  const playRow = page.locator(".nh-deck-rows .nh-deck-card, .PlayLifecycleCard, [class*='nh-deck-card']").first();
  if (!(await playRow.count())) {
    throw new Error("No swing play rows found on Swings desk");
  }
  await playRow.click();
  await page.waitForTimeout(1500);

  const largoBrief = page.locator(".nh-deck-largo--brief");
  await largoBrief.waitFor({ state: "visible", timeout: 30_000 });
  await page.waitForSelector(".nh-deck-largo__bie, .nh-deck-largo__loading", { timeout: 30_000 });
  await page.waitForTimeout(6000);

  captured.push(`${OUT}/02-swings-full-with-ask-largo.png`);
  await page.screenshot({ path: captured.at(-1), fullPage: false });

  const box = await largoBrief.boundingBox();
  if (box) {
    const clipPath = `${OUT}/03-ask-largo-panel-crop.png`;
    await page.screenshot({
      path: clipPath,
      clip: {
        x: Math.max(0, box.x - 8),
        y: Math.max(0, box.y - 8),
        width: Math.min(1680, box.width + 16),
        height: Math.min(1050, box.height + 16),
      },
    });
    captured.push(clipPath);
  }

  const dom = await page.evaluate(() => {
    const panel = document.querySelector(".nh-deck-largo--brief");
    const kicker = panel?.querySelector(".nh-deck-largo__kicker")?.textContent?.trim() ?? "";
    const title = panel?.querySelector(".nh-deck-largo__title")?.textContent?.trim() ?? "";
    const engine = panel?.querySelector(".nh-deck-largo__engine")?.textContent?.trim() ?? "";
    const asof = panel?.querySelector(".nh-deck-largo__asof")?.textContent?.trim() ?? "";
    const sections = [...document.querySelectorAll(".nh-deck-largo__bie h3, .nh-deck-largo__bie h4, .bie-answer__section-title")]
      .map((el) => (el.textContent || "").trim())
      .filter(Boolean);
    return {
      kicker,
      title,
      engine,
      asof,
      sections: sections.slice(0, 12),
      hasBieBody: !!document.querySelector(".nh-deck-largo__bie-body, .bie-answer"),
      hasLoading: !!document.querySelector(".nh-deck-largo__loading"),
      hasError: !!document.querySelector(".nh-deck-largo__error"),
    };
  });

  const report = {
    base: BASE,
    capturedAt: new Date().toISOString(),
    shots: captured,
    dom,
    pass:
      /Ask Largo/i.test(dom.kicker) &&
      dom.hasBieBody &&
      !dom.hasError &&
      !dom.hasLoading &&
      /Deterministic/i.test(dom.engine),
  };

  await writeFile(`${OUT}/capture-report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));

  await browser.close();
  await session.cleanup();
  process.exit(report.pass ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
