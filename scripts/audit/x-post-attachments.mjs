#!/usr/bin/env node
/**
 * High-DPI desk screenshots for manual X posts — 3 PNG attachments per post pack.
 * Uses Clerk env keys (no AWS CLI). Artifacts: /opt/cursor/artifacts/x-posts/
 *
 * Usage:
 *   node --import tsx scripts/audit/x-post-attachments.mjs
 *   node --import tsx scripts/audit/x-post-attachments.mjs --ticker SPX --packs nodes,flow,plays
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { mintIosPlaywrightSession } from "./lib/ios-playwright-auth.mjs";
import { prepareVectorShowcaseChart, waitForSpxDeskReady } from "./lib/vector-showcase-prep.mjs";
import { assertCapturableUrl } from "@/lib/x-intel/capture-guard";

const args = process.argv.slice(2);
const opt = (k, def) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};

const BASE = "https://blackouttrades.com";
const TICKER = opt("ticker", "SPX").toUpperCase();
const PACKS = opt("packs", "nodes,flow,plays,morning").split(",").map((s) => s.trim()).filter(Boolean);
const OUT_ROOT = "/opt/cursor/artifacts/x-posts";

/** Retina PNG — X compresses uploads; start sharp. */
const VIEWPORT = { width: 1920, height: 1080 };
const DEVICE_SCALE = 2;

mkdirSync(OUT_ROOT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function mintClerkSession() {
  const session = await mintIosPlaywrightSession({ appUrl: BASE });
  if (session.skip) throw new Error(session.reason ?? "Clerk session unavailable");
  return session;
}

async function dismissOverlays(page) {
  for (const sel of ['button:has-text("SKIP")', 'button:has-text("Got it")', '[aria-label="Close"]']) {
    try {
      const el = page.locator(sel).first();
      if ((await el.count()) > 0 && (await el.isVisible())) {
        await el.click({ timeout: 1500 });
        await sleep(400);
      }
    } catch {
      /* ignore */
    }
  }
}

async function shot(page, target, context, opts = {}) {
  assertCapturableUrl(page.url(), context);
  return (target ?? page).screenshot({
    type: "png",
    animations: "disabled",
    caret: "hide",
    ...opts,
  });
}

async function shotPanel(page, locator, context, maxH = 920) {
  const el = locator.first();
  await el.waitFor({ state: "visible", timeout: 45_000 });
  await el.evaluate((node) => {
    node.scrollTop = 0;
  });
  await sleep(500);
  const clip = await el.evaluate((node, h) => {
    const r = node.getBoundingClientRect();
    return {
      x: Math.max(0, r.x),
      y: Math.max(0, r.y),
      width: Math.min(r.width, 1880),
      height: Math.min(r.height, h),
    };
  }, maxH);
  return shot(page, null, context, { clip });
}

async function savePackDir(packId, files) {
  const dir = join(OUT_ROOT, packId);
  mkdirSync(dir, { recursive: true });
  const manifest = { ticker: TICKER, pack: packId, createdAt: new Date().toISOString(), attachments: [] };
  for (const { name, buf, label } of files) {
    const path = join(dir, name);
    writeFileSync(path, buf);
    manifest.attachments.push({ file: name, label, bytes: buf.length, path });
    console.log(`  ✓ ${path} (${buf.length} bytes)`);
  }
  writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest, null, 2));
  return dir;
}

async function warmThermalChain(page, sym) {
  await page.evaluate(async (t) => {
    await fetch(`/api/market/gex-heatmap?ticker=${encodeURIComponent(t)}&force=1`, {
      credentials: "include",
    });
  }, sym);
}

async function captureThermal(page, sym) {
  await page.goto(`${BASE}/heatmap`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await dismissOverlays(page);
  await page.waitForSelector(".gex-heatmap-desk", { timeout: 45_000 });
  await sleep(2000);
  await warmThermalChain(page, sym);
  const trigger = page.locator('button[aria-label*="Change ticker"]').first();
  await trigger.click();
  const search = page.locator('input[aria-label="Search any ticker"]').first();
  await search.waitFor({ state: "visible", timeout: 10_000 });
  await search.fill(sym);
  await sleep(1200);
  const option = page.locator("#ticker-listbox button").filter({ hasText: sym }).first();
  if (await option.count()) await option.click();
  else await search.press("Enter");
  await sleep(6000);
  const panel = page.locator(".gex-heatmap-desk").first();
  return shotPanel(page, panel, "thermal matrix", 980);
}

async function captureVector(page, sym) {
  if (sym === "SPX") {
    await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded", timeout: 90_000 });
    await dismissOverlays(page);
    await waitForSpxDeskReady(page);
    await prepareVectorShowcaseChart(page);
    const stage = page.locator(".vector-chart-stage").first();
    return shot(page, stage, "SPX Slayer Vector showcase chart");
  }

  await page.goto(`${BASE}/vector?ticker=${encodeURIComponent(sym)}`, {
    waitUntil: "domcontentloaded",
    timeout: 90_000,
  });
  await dismissOverlays(page);
  await page.waitForSelector(".vector-chart-wrap", { timeout: 45_000 });
  await sleep(2000);
  await prepareVectorShowcaseChart(page);
  const stage = page.locator(".vector-chart-stage").first();
  return shot(page, stage, `Vector ${sym} showcase chart`);
}

async function captureHelix(page, sym) {
  await page.goto(`${BASE}/flows`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await dismissOverlays(page);
  await sleep(3000);
  const search = page.locator("#helix-ticker-search").first();
  await search.waitFor({ state: "visible", timeout: 20_000 });
  await search.click();
  await search.fill("");
  await search.pressSequentially(sym, { delay: 50 });
  await search.press("Tab");
  await sleep(5000);
  const hide = page.getByRole("button", { name: "Hide analytics" });
  if (await hide.count()) {
    await hide.click();
    await sleep(800);
  }
  const panel = page.locator(".helix-desk-terminal, .helix-pro-desk").first();
  return shotPanel(page, panel, "helix tape", 900);
}

async function captureSlayer(page) {
  await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await dismissOverlays(page);
  await sleep(8000);
  const desk = page.locator(".spx-desk-shell, .spx-gex-matrix-wrap, main").first();
  if (await desk.count()) return shotPanel(page, desk, "spx slayer", 1000);
  return shot(page, null, "spx slayer full viewport");
}

async function captureNighthawkBoard(page) {
  await page.goto(`${BASE}/nighthawk`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await dismissOverlays(page);
  await page.waitForSelector(".nh-v2-col-zerodte, .nighthawk-desk", { timeout: 45_000 });
  await sleep(6000);
  const col = page.locator(".nh-v2-col-zerodte").first();
  if (await col.count()) return shotPanel(page, col, "nighthawk 0dte column", 1000);
  return shot(page, null, "nighthawk desk");
}

async function captureNighthawkPlayCard(page, sym) {
  await page.goto(`${BASE}/nighthawk`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await dismissOverlays(page);
  await page.waitForSelector(".nh-v2-zerodte-card", { timeout: 90_000 });
  await sleep(4000);
  const cards = page.locator(".nh-v2-zerodte-card");
  const count = await cards.count();
  for (let i = 0; i < count; i++) {
    const card = cards.nth(i);
    const text = (await card.innerText()).toUpperCase();
    if (text.includes(sym) || (sym === "SPX" && text.includes("SPXW"))) {
      return shot(page, card, "nighthawk play card");
    }
  }
  const first = cards.first();
  return shot(page, first, "nighthawk play card fallback");
}

const PACK_DEFS = {
  nodes: {
    id: "01-nodes-watch",
    title: "What to watch — nodes + walls",
    shots: ["thermal", "slayer", "vector"],
  },
  flow: {
    id: "02-flow-tape",
    title: "Flow-led read",
    shots: ["helix", "nighthawk-card", "vector"],
  },
  plays: {
    id: "03-plays-board",
    title: "Plays / board recap",
    shots: ["nighthawk-board", "helix", "thermal"],
  },
  morning: {
    id: "04-morning-hook",
    title: "Pre-open checklist",
    shots: ["vector", "thermal", "slayer"],
  },
};

async function captureOne(page, key, sym) {
  switch (key) {
    case "thermal":
      return { key, label: `Thermal · ${sym} GEX matrix`, buf: await captureThermal(page, sym) };
    case "vector":
      return { key, label: `Vector · ${sym} 0DTE chart`, buf: await captureVector(page, sym) };
    case "helix":
      return { key, label: `Helix · ${sym} flow`, buf: await captureHelix(page, sym) };
    case "slayer":
      return { key, label: "SPX Slayer · matrix + rails", buf: await captureSlayer(page) };
    case "nighthawk-board":
      return { key, label: "Night Hawk · 0DTE board", buf: await captureNighthawkBoard(page) };
    case "nighthawk-card":
      return {
        key,
        label: `Night Hawk · ${sym} play card`,
        buf: await captureNighthawkPlayCard(page, sym === "SPX" ? "SPXW" : sym),
      };
    default:
      throw new Error(`Unknown shot: ${key}`);
  }
}

async function main() {
  console.log(`[x-post-attachments] ticker=${TICKER} packs=${PACKS.join(",")} scale=${DEVICE_SCALE}x`);
  const auth = await mintClerkSession();
  console.log(`Clerk session ready (user ${auth.userId ?? "ok"})`);

  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  const ctx = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: DEVICE_SCALE,
    colorScheme: "dark",
  });
  if (auth.cookies?.length) await ctx.addCookies(auth.cookies);
  await ctx.addInitScript(() => {
    try {
      window.localStorage.setItem("blackout:onboarding:v", "2");
    } catch {
      /* ignore */
    }
  });
  const page = await ctx.newPage();

  const cache = new Map();
  const dirs = [];

  try {
    await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await dismissOverlays(page);
    await sleep(2000);

    for (const packKey of PACKS) {
      const def = PACK_DEFS[packKey];
      if (!def) {
        console.warn(`Skip unknown pack: ${packKey}`);
        continue;
      }
      console.log(`\nPack: ${def.title}`);
      const files = [];
      for (let i = 0; i < def.shots.length; i++) {
        const shotKey = def.shots[i];
        const cacheKey = `${shotKey}:${TICKER}`;
        if (!cache.has(cacheKey)) {
          console.log(`  capturing ${shotKey}…`);
          cache.set(cacheKey, await captureOne(page, shotKey, TICKER));
        }
        const cap = cache.get(cacheKey);
        files.push({
          name: `${String(i + 1).padStart(2, "0")}-${shotKey}.png`,
          buf: cap.buf,
          label: cap.label,
        });
      }
      dirs.push(await savePackDir(def.id, files));
    }

    const index = {
      ticker: TICKER,
      createdAt: new Date().toISOString(),
      deviceScaleFactor: DEVICE_SCALE,
      viewport: VIEWPORT,
      packs: PACKS.map((k) => PACK_DEFS[k]).filter(Boolean),
      directories: dirs,
    };
    writeFileSync(join(OUT_ROOT, "index.json"), JSON.stringify(index, null, 2));
    console.log(`\nDone. Attachments under ${OUT_ROOT}/`);
  } finally {
    await browser.close();
    await auth.cleanup();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
