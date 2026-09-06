#!/usr/bin/env node
/**
 * Validate Ask Largo swing play brief across OPEN / WATCH / CLOSED tabs on live UI.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import { mintClerkPremiumSession } from "./lib/prod-clerk-session.mjs";
import { resolveChromiumPath } from "./lib/playwright-chromium-path.mjs";

const BASE = (process.env.VALIDATE_BASE || "https://blackouttrades.com").replace(/\/$/, "");
const OUT = process.env.SCREENSHOT_OUT || "/opt/cursor/artifacts/ask-largo-validate-20260905";

const TABS = ["OPEN", "WATCH", "CLOSED"];

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

async function readLargoPanel(page) {
  return page.evaluate(() => {
    const panel = document.querySelector(".nh-deck-largo--brief, .nh-deck-largo-empty");
    const isEmpty = !!document.querySelector(".nh-deck-largo-empty");
    const kicker = panel?.querySelector(".nh-deck-largo__kicker")?.textContent?.trim() ?? "";
    const title = panel?.querySelector(".nh-deck-largo__title")?.textContent?.trim() ?? "";
    const engine = panel?.querySelector(".nh-deck-largo__engine")?.textContent?.trim() ?? "";
    const asof = panel?.querySelector(".nh-deck-largo__asof")?.textContent?.trim() ?? "";
    const headline = document.querySelector(".bie-answer__headline, .bie-answer h2, .nh-deck-largo__bie h2")
      ?.textContent?.trim() ?? "";
    const sections = [...document.querySelectorAll(".bie-answer__section-title, .nh-deck-largo__bie h3, .nh-deck-largo__bie h4")]
      .map((el) => (el.textContent || "").trim())
      .filter(Boolean);
    const bodyText = document.querySelector(".nh-deck-largo__bie-body, .bie-answer__body")?.textContent?.trim() ?? "";
    const selectedRow = document.querySelector(".nh-deck-card.is-selected, .nh-deck-card.selected, .nh-deck-card[aria-selected='true'], .nh-deck-card:focus-within");
    const rowText = selectedRow?.textContent?.replace(/\s+/g, " ").trim().slice(0, 120) ?? "";
    const rowStatus = selectedRow?.querySelector(".nh-deck-card__status, .nh-deck-status, [class*='status']")?.textContent?.trim() ?? "";
    return {
      isEmpty,
      kicker,
      title,
      headline,
      engine,
      asof,
      sections,
      bodySnippet: bodyText.slice(0, 600),
      rowText,
      rowStatus,
      hasBieBody: !!document.querySelector(".nh-deck-largo__bie-body, .bie-answer"),
      hasLoading: !!document.querySelector(".nh-deck-largo__loading"),
      hasError: !!document.querySelector(".nh-deck-largo__error"),
      hasRefresh: !!document.querySelector(".nh-deck-largo__refresh"),
      hasOpenLink: !!document.querySelector(".nh-deck-largo__open"),
    };
  });
}

async function clickFilter(page, tab) {
  const bar = page.locator('.nh-deck-filterbar[aria-label="Filter plays by status"]');
  const btn = bar.locator(".nh-deck-filtbtn").filter({ hasText: new RegExp(`^${tab}\\b`, "i") });
  await btn.click({ timeout: 15_000 });
  await page.waitForTimeout(1500);
}

async function rowLocator(page) {
  return page.locator(".nh-deck-rows .nh-deck-row");
}

async function selectFirstPlay(page) {
  const rows = await rowLocator(page);
  const count = await rows.count();
  if (!count) return { found: false, count: 0 };
  await rows.first().click();
  await page.waitForTimeout(800);
  return { found: true, count };
}

async function waitForBrief(page) {
  await page.waitForSelector(".nh-deck-largo--brief, .nh-deck-largo-empty", { timeout: 30_000 });
  await page.waitForSelector(".nh-deck-largo__bie, .nh-deck-largo__loading, .nh-deck-largo-empty", { timeout: 30_000 });
  // Wait for skeleton to clear
  for (let i = 0; i < 12; i++) {
    const loading = await page.locator(".nh-deck-largo__loading").count();
    if (!loading) break;
    await page.waitForTimeout(1000);
  }
  await page.waitForTimeout(1500);
}

async function probeApi(page, playId, ticker) {
  if (!playId || !ticker) return { skipped: true };
  const url = `/api/market/swing/play-brief?playId=${encodeURIComponent(playId)}&ticker=${encodeURIComponent(ticker)}`;
  return page.evaluate(async (u) => {
    const res = await fetch(u, { credentials: "include" });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* ignore */ }
    const sections = json?.envelope?.sections?.map((s) => s.title) ?? json?.sections?.map((s) => s.title) ?? [];
    return {
      status: res.status,
      available: json?.available ?? null,
      engine: json?.engine ?? null,
      headline: json?.envelope?.headline ?? json?.headline ?? null,
      sections,
      error: json?.error ?? null,
    };
  }, url);
}

async function extractPlayMeta(page) {
  return page.evaluate(() => {
    const row = document.querySelector(".nh-deck-rows .nh-deck-row.sel")
      ?? document.querySelector(".nh-deck-rows .nh-deck-row[aria-current='true']")
      ?? document.querySelector(".nh-deck-rows .nh-deck-row");
    const text = row?.textContent?.replace(/\s+/g, " ") ?? "";
    const ticker = row?.querySelector(".nh-deck-tk")?.textContent?.trim() ?? null;
    const contract = row?.querySelector(".nh-deck-sub")?.textContent?.trim() ?? null;
    const status = row?.querySelector(".nh-deck-status, .nh-deck-lc-status")?.textContent?.trim() ?? "";
    return { playId: null, ticker, contract, status, rowText: text.slice(0, 140) };
  });
}

function expectedSections(tab) {
  if (tab === "OPEN") return ["Verdict", "Management", "Trade manager read"];
  if (tab === "WATCH") return ["Verdict", "Entry"];
  return ["Verdict", "Outcome"];
}

function validateTabV4(tab, panel, apiCalls = []) {
  const issues = [];
  if (tab === "OPEN") {
    const collapsed = ["Hold plan", "GEX posture", "Flow & positioning"];
    for (const title of collapsed) {
      if (panel.sections.includes(title)) {
        issues.push(`v4: OPEN still has uncollapsed section "${title}"`);
      }
    }
    if (!panel.sections.includes("Trade manager read")) {
      issues.push("v4: missing Trade manager read");
    }
  }
  const lastApi = apiCalls.at(-1);
  if (lastApi?.sections?.length && tab === "OPEN") {
    if (lastApi.sections.includes("Hold plan")) {
      issues.push("v4 api: Hold plan should be collapsed");
    }
  }
  return issues;
}

function validateTab(tab, panel, api, rowCount, apiCalls = []) {
  const issues = [];
  const warnings = [];
  if (rowCount === 0) issues.push("no rows in filter");
  if (panel.isEmpty) issues.push("largo panel empty after row click");
  if (!/Ask Largo/i.test(panel.kicker)) issues.push(`bad kicker: ${panel.kicker}`);
  if (panel.hasError) issues.push("brief error state");
  if (panel.hasLoading) issues.push("still loading");
  if (!panel.hasBieBody && rowCount > 0) issues.push("no BieAnswer body");
  if (!panel.hasRefresh) issues.push("missing refresh button");
  if (!panel.hasOpenLink) issues.push("missing Open link");
  if (!/Deterministic/i.test(panel.engine)) issues.push(`footer missing deterministic tag: ${panel.engine}`);

  for (const exp of expectedSections(tab)) {
    if (!panel.sections.some((s) => s.toLowerCase().includes(exp.toLowerCase()))) {
      issues.push(`missing section: ${exp} (got: ${panel.sections.join(", ")})`);
    }
  }

  if (panel.title && panel.headline && !panel.headline.includes(panel.title.split(" ")[0])) {
    warnings.push(`headline/title mismatch: title=${panel.title} headline=${panel.headline}`);
  }

  const lastApi = apiCalls.at(-1);
  if (lastApi?.sections?.length) {
    for (const exp of expectedSections(tab)) {
      if (!lastApi.sections.some((s) => s.toLowerCase().includes(exp.toLowerCase()))) {
        warnings.push(`api sections mismatch for ${tab}: ${lastApi.sections.join(", ")}`);
      }
    }
  }

  if (api && !api.skipped) {
    if (api.status !== 200) issues.push(`api HTTP ${api.status}`);
    if (api.available === false) issues.push(`api unavailable: ${api.error ?? "unknown"}`);
    if (api.engine && api.engine !== "swing_play_intelligence") issues.push(`api engine ${api.engine}`);
  }

  issues.push(...validateTabV4(tab, panel, apiCalls));

  return { pass: issues.length === 0, issues, warnings };
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

  const browser = await chromium.launch({
    headless: true,
    executablePath: resolveChromiumPath(),
    args: ["--no-sandbox"],
  });
  const host = new URL(BASE).hostname;
  const ctx = await browser.newContext({ viewport: { width: 1680, height: 1050 }, deviceScaleFactor: 1.5 });
  await ctx.addCookies(cookiesFromHeader(session.cookieHeader, host));
  const page = await ctx.newPage();
  const apiCalls = [];
  page.on("response", async (res) => {
    const url = res.url();
    if (!url.includes("/api/market/swing/play-brief")) return;
    let json = null;
    try { json = await res.json(); } catch { /* ignore */ }
    apiCalls.push({
      url,
      status: res.status(),
      playId: json?.playId ?? null,
      headline: json?.envelope?.headline ?? null,
      sections: json?.envelope?.sections?.map((s) => s.title) ?? [],
      briefContentKey: json?.briefContentKey ?? null,
    });
  });

  await page.goto(`${BASE}/nighthawk?view=swings`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.waitForTimeout(5000);

  const tabResults = {};
  const shots = [];

  for (const tab of TABS) {
    await clickFilter(page, tab);
    const { found, count } = await selectFirstPlay(page);
    if (!found) {
      tabResults[tab] = { pass: false, issues: ["no play rows"], rowCount: 0 };
      continue;
    }
    await waitForBrief(page);

    const slug = tab.toLowerCase();
    const fullPath = `${OUT}/${slug}-full-desk.png`;
    await page.screenshot({ path: fullPath, fullPage: false });
    shots.push(fullPath);

    const largo = page.locator(".nh-deck-largo--brief");
    if (await largo.count()) {
      const box = await largo.boundingBox();
      if (box) {
        const cropPath = `${OUT}/${slug}-ask-largo-crop.png`;
        await page.screenshot({
          path: cropPath,
          clip: {
            x: Math.max(0, box.x - 8),
            y: Math.max(0, box.y - 8),
            width: Math.min(1680, box.width + 16),
            height: Math.min(1050, box.height + 16),
          },
        });
        shots.push(cropPath);
      }
    }

    const panel = await readLargoPanel(page);
    const meta = await extractPlayMeta(page);
    const api = await probeApi(page, meta.playId, meta.ticker);
    const validation = validateTab(tab, panel, api, count, apiCalls);

    tabResults[tab] = {
      ...validation,
      rowCount: count,
      meta,
      panel,
      api,
      apiCalls: apiCalls.slice(-3),
    };
    apiCalls.length = 0;
  }

  // Second WATCH play if available
  await clickFilter(page, "WATCH");
  const watchRows = await rowLocator(page);
  if (await watchRows.count() > 1) {
    await watchRows.nth(1).click();
    await waitForBrief(page);
    const panel2 = await readLargoPanel(page);
    const path2 = `${OUT}/watch-second-play-crop.png`;
    const largo = page.locator(".nh-deck-largo--brief");
    const box = await largo.boundingBox();
    if (box) {
      await page.screenshot({
        path: path2,
        clip: { x: box.x, y: box.y, width: box.width, height: box.height },
      });
      shots.push(path2);
    }
    tabResults.WATCH_SECOND = { panel: panel2 };
  }

  // Second CLOSED play if available
  await clickFilter(page, "CLOSED");
  const closedRows = await rowLocator(page);
  if (await closedRows.count() > 1) {
    await closedRows.nth(1).click();
    await waitForBrief(page);
    const panel2 = await readLargoPanel(page);
    const path2 = `${OUT}/closed-second-play-crop.png`;
    const largo = page.locator(".nh-deck-largo--brief");
    const box = await largo.boundingBox();
    if (box) {
      await page.screenshot({
        path: path2,
        clip: { x: box.x, y: box.y, width: box.width, height: box.height },
      });
      shots.push(path2);
    }
    tabResults.CLOSED_SECOND = { panel: panel2 };
  }

  const report = {
    base: BASE,
    capturedAt: new Date().toISOString(),
    shots,
    tabs: tabResults,
    pass: TABS.every((t) => tabResults[t]?.pass),
  };

  await writeFile(`${OUT}/validation-report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));

  await browser.close();
  await session.cleanup();
  process.exit(report.pass ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
