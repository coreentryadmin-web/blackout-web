#!/usr/bin/env node
/**
 * Validate swing brief v4 on live UI — collapsed intel, narrative pulse, API contract.
 *
 * Uses createTunneledContext (CONNECT tunnel) — Chromium has no direct network in this sandbox.
 * Run from repo root: NODE_USE_ENV_PROXY=1 node scripts/audit/ask-largo-swing-brief-v4-validate.mjs
 */
import { mkdir, writeFile } from "node:fs/promises";
import { mintClerkPremiumSession } from "./lib/prod-clerk-session.mjs";
import { createPlaywrightAuditContext } from "./lib/playwright-audit-context.mjs";

const BASE = (process.env.VALIDATE_BASE || "https://blackouttrades.com").replace(/\/$/, "");
const OUT = process.env.SCREENSHOT_OUT || "/opt/cursor/artifacts/ask-largo-v4-live-validate";

const COLLAPSED_WHEN_NARRATIVE = new Set([
  "Book context",
  "Lane rank",
  "Levels on chart",
  "GEX posture",
  "Wall dynamics",
  "Flow & positioning",
  "Macro tape",
  "Desk consensus",
  "Hold plan",
  "Vector desk",
]);

function validateV4Open(apiJson, panelSections) {
  const issues = [];
  const warnings = [];
  const sections = apiJson?.envelope?.sections ?? [];
  const titles = sections.map((s) => s.title);
  const narrative = sections.find((s) => s.title === "Trade manager read");

  if (!titles.includes("Trade manager read")) {
    issues.push("missing Trade manager read section");
  }
  if (!narrative?.body?.includes("•")) {
    issues.push("Trade manager read has no coaching bullets");
  }

  const stillPresent = titles.filter((t) => COLLAPSED_WHEN_NARRATIVE.has(t));
  if (stillPresent.length) {
    issues.push(`v4 collapse not live — redundant sections still present: ${stillPresent.join(", ")}`);
  }

  if (narrative && !/folded into Trade manager read/i.test(narrative.body)) {
    warnings.push("narrative missing folded-section footnote (may be zero drops on this row)");
  }

  if (!apiJson?.briefContentKey) {
    issues.push("API missing briefContentKey");
  }

  const uiHasHold = panelSections.includes("Hold plan");
  const uiHasGex = panelSections.includes("GEX posture");
  if (uiHasHold || uiHasGex) {
    issues.push(`UI still shows pre-v4 sections: hold=${uiHasHold} gex=${uiHasGex}`);
  }

  return { issues, warnings, titles, narrativeSnippet: narrative?.body?.slice(0, 400) ?? "" };
}

async function clickFilter(page, tab) {
  const bar = page.locator('.nh-deck-filterbar[aria-label="Filter plays by status"]');
  await bar.locator(".nh-deck-filtbtn").filter({ hasText: new RegExp(`^${tab}\\b`, "i") }).click({ timeout: 15_000 });
  await page.waitForTimeout(1500);
}

async function selectFirstOpen(page) {
  const rows = page.locator(".nh-deck-rows .nh-deck-row");
  const count = await rows.count();
  if (!count) return { found: false, count: 0 };
  await rows.first().click();
  await page.waitForTimeout(2500);
  return { found: true, count };
}

async function readPanelSections(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll(".bie-answer__section-title, .nh-deck-largo__bie h3, .nh-deck-largo__bie h4")]
      .map((el) => (el.textContent || "").trim())
      .filter(Boolean),
  );
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

  const { browser, ctx, counts, mode } = await createPlaywrightAuditContext({
    url: BASE,
    cookie: session.cookieHeader,
    viewport: "1680x1050",
    desktop: true,
    requestTimeoutMs: 60_000,
  });
  const page = await ctx.newPage();

  let lastBriefApi = null;
  page.on("response", async (res) => {
    if (!res.url().includes("/api/market/swing/play-brief")) return;
    try {
      lastBriefApi = await res.json();
    } catch {
      /* ignore */
    }
  });

  await page.goto(`${BASE}/nighthawk?view=swings`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.waitForTimeout(5000);
  await clickFilter(page, "OPEN");
  const { found, count } = await selectFirstOpen(page);
  if (!found) {
    console.error("No OPEN rows");
    process.exit(1);
  }

  await page.waitForSelector(".nh-deck-largo--brief, .nh-deck-largo__bie-body", { timeout: 30_000 }).catch(() => {});
  await page.waitForTimeout(2000);

  const panelSections = await readPanelSections(page);
  const cropPath = `${OUT}/open-v4-narrative-crop.png`;
  const largo = page.locator(".nh-deck-largo--brief");
  const box = await largo.boundingBox();
  if (box) {
    await page.screenshot({
      path: cropPath,
      clip: { x: Math.max(0, box.x - 8), y: Math.max(0, box.y - 8), width: box.width + 16, height: box.height + 16 },
    });
  }

  // Second poll to capture pulse — click refresh if present
  const refresh = page.locator(".nh-deck-largo__refresh");
  if (await refresh.count()) {
    await refresh.click();
    await page.waitForTimeout(3000);
  }
  const pulsePath = `${OUT}/open-v4-after-refresh.png`;
  if (box) {
    await page.screenshot({ path: pulsePath, clip: { x: box.x, y: box.y, width: box.width, height: box.height } });
  }

  const narrativeBody = await page.evaluate(() => {
    const titles = [...document.querySelectorAll(".bie-answer__section-title, .nh-deck-largo__bie h3")];
    const idx = titles.findIndex((el) => /trade manager read/i.test(el.textContent || ""));
    if (idx < 0) return "";
    const section = titles[idx]?.closest("section, .bie-answer__section, div");
    return section?.textContent?.slice(0, 800) ?? "";
  });

  const v4 = validateV4Open(lastBriefApi, panelSections);
  const hasPulse = /since last read/i.test(narrativeBody);

  const report = {
    base: BASE,
    capturedAt: new Date().toISOString(),
    openRowCount: count,
    deployCheck: {
      apiSections: v4.titles,
      panelSections,
      briefContentKey: lastBriefApi?.briefContentKey ?? null,
      trimsFired: lastBriefApi?.trimsFired ?? null,
    },
    v4,
    pulse: { hasSinceLastRead: hasPulse, narrativeSnippet: narrativeBody.slice(0, 500) },
    shots: [cropPath, pulsePath],
    pass: counts.fail === 0 && v4.issues.length === 0,
    routed: counts,
    mode,
  };

  await writeFile(`${OUT}/v4-validation-report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));

  await browser.close();
  await session.cleanup();
  process.exit(report.pass ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
