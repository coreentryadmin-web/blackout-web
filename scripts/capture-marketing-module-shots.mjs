#!/usr/bin/env node
/**
 * Capture polished marketing screenshots for all six platform modules.
 * Output: public/images/marketing/{spx,helix,thermal,largo,hawk,vector}.webp
 *   and, with SHOTS>1, additional per-module views: {id}-2.webp, {id}-3.webp …
 *
 * MUST run from a browser-capable environment (staging/CI/Cursor) — headless
 * Chromium egress is blocked in the Claude sandbox, so this cannot run there.
 *
 * Env:
 *   CAPTURE_BASE_URL   target host (default staging)
 *   SHOTS              screenshots per module (default 1; e.g. 3 for a gallery)
 *   SHOT_TICKERS       per-module override, e.g. "spx=SPX,helix=NVDA,thermal=TSLA"
 *                      — the module is loaded, that ticker is searched, THEN captured,
 *                      so the shot shows a deliberate ticker rather than the default.
 *   SHOT_QUALITY       webp quality (default 90 — sharper than the old 84)
 */
import { execSync } from "node:child_process";
import { mkdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { chromium } from "playwright";
import { mintIosPlaywrightSession, onboardingInitScript } from "./audit/lib/ios-playwright-auth.mjs";

const BASE = (process.env.CAPTURE_BASE_URL ?? process.env.STAGING_BASE_URL ?? "https://staging.blackouttrades.com").replace(/\/$/, "");
const USE_STAGING_SECRET = BASE.includes("staging.");
const SECRET_NAME = process.env.STAGING_SECRET_NAME ?? "blackout-staging/app/env";
const OUT_DIR = join(process.cwd(), "public/images/marketing");
const VIEWPORT = { width: 1440, height: 900 };

const MODULES = [
  {
    id: "spx",
    path: "/dashboard",
    selector: ".spx-sniper-desk",
    ready: async (page) => {
      await page.waitForSelector(".spx-sniper-desk", { timeout: 60_000 });
      await page.waitForFunction(
        () => !document.querySelector(".spx-sniper-desk-loading"),
        { timeout: 90_000 }
      );
      const gex = page.locator("[id*='matrix-tab-gex'], #spx-matrix-tab-gex").first();
      if (await gex.isVisible().catch(() => false)) await gex.click();
      await page.waitForTimeout(3000);
    },
  },
  {
    id: "helix",
    path: "/flows",
    selector: ".helix-page-shell",
    ready: async (page) => {
      await page.waitForSelector(".helix-page-shell", { timeout: 60_000 });
      await page.waitForSelector(".flow-scroll-max, .flow-scroll, .flow-panel", { timeout: 60_000 });
      await page.waitForTimeout(3500);
    },
  },
  {
    id: "thermal",
    path: "/heatmap",
    selector: "main",
    ready: async (page) => {
      await page.waitForSelector(".gex-matrix-scroll, .gex-heatmap, table", { timeout: 60_000 });
      const tab = page.getByRole("tab", { name: /^gex$/i }).first();
      if (await tab.isVisible().catch(() => false)) await tab.click();
      await page.waitForTimeout(3000);
    },
  },
  {
    id: "largo",
    path: "/terminal",
    selector: "main",
    ready: async (page) => {
      await page.waitForLoadState("networkidle", { timeout: 60_000 }).catch(() => null);
      await page.waitForTimeout(4000);
    },
  },
  {
    id: "hawk",
    path: "/nighthawk",
    selector: "main",
    ready: async (page) => {
      await page.waitForLoadState("networkidle", { timeout: 60_000 }).catch(() => null);
      await page.waitForTimeout(4000);
    },
  },
  {
    id: "vector",
    path: "/vector",
    selector: "main",
    ready: async (page) => {
      await page.waitForLoadState("networkidle", { timeout: 60_000 }).catch(() => null);
      await page.waitForTimeout(2500);
    },
  },
];

const SHOTS = Math.max(1, Number(process.env.SHOTS || 1));
const SHOT_QUALITY = Math.min(100, Math.max(60, Number(process.env.SHOT_QUALITY || 90)));
const SHOT_TICKERS = Object.fromEntries(
  (process.env.SHOT_TICKERS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((kv) => kv.split("=").map((x) => x.trim()))
);

/**
 * Best-effort: type a specific ticker into whatever search/command surface the
 * module page exposes, so the shot shows a deliberate symbol rather than the
 * default. Silently no-ops if the page has no ticker search (e.g. SPX-only).
 */
async function searchTicker(page, ticker) {
  if (!ticker) return;
  const candidates = [
    'input[placeholder*="Search" i]',
    'input[placeholder*="ticker" i]',
    'input[aria-label*="ticker" i]',
    'input[aria-label*="search" i]',
    'input[type="search"]',
    '[data-ticker-search] input',
  ];
  for (const sel of candidates) {
    const inp = page.locator(sel).first();
    if (await inp.isVisible().catch(() => false)) {
      await inp.click().catch(() => {});
      await inp.fill(ticker).catch(() => {});
      await page.waitForTimeout(700);
      // pick the first suggestion if a listbox opened, else Enter
      const opt = page.getByRole("option").first();
      if (await opt.isVisible().catch(() => false)) await opt.click().catch(() => {});
      else await inp.press("Enter").catch(() => {});
      await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => null);
      await page.waitForTimeout(2500);
      console.log(`     searched ticker ${ticker}`);
      return;
    }
  }
  console.log(`     (no ticker search on ${page.url()} — captured default)`);
}

function loadSecret() {
  const raw = execSync(
    `aws secretsmanager get-secret-value --secret-id "${SECRET_NAME}" --query SecretString --output text`,
    { encoding: "utf8" }
  );
  return JSON.parse(raw);
}

async function hasErrorPage(page) {
  const body = await page.locator("body").innerText().catch(() => "");
  return /couldn't load this page|something went wrong/i.test(body);
}

async function captureModule(page, mod, attempt = 1) {
  console.log(`  → ${mod.id} (${mod.path}) attempt ${attempt}`);
  await page.goto(`${BASE}${mod.path}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.waitForLoadState("networkidle", { timeout: 45_000 }).catch(() => null);
  await mod.ready(page);

  if (await hasErrorPage(page)) {
    if (attempt < 3) {
      await page.waitForTimeout(2000);
      return captureModule(page, mod, attempt + 1);
    }
    throw new Error(`${mod.id}: error page after 3 attempts`);
  }

  // Optionally drive a specific ticker into the page before shooting.
  await searchTicker(page, SHOT_TICKERS[mod.id]);

  const target = page.locator(mod.selector).first();
  const hasTarget = await target.isVisible().catch(() => false);

  for (let shot = 1; shot <= SHOTS; shot++) {
    // Views after the first scroll the page to surface a different panel, so a
    // gallery shows genuinely different parts of the desk (not the same frame).
    if (shot > 1) {
      await page.evaluate((n) => window.scrollBy({ top: Math.round(window.innerHeight * 0.72 * n), behavior: "instant" }), shot - 1).catch(() => {});
      await page.waitForTimeout(1400);
    }
    const suffix = shot === 1 ? "" : `-${shot}`;
    const pngPath = join(OUT_DIR, `${mod.id}${suffix}.png`);
    const webpPath = join(OUT_DIR, `${mod.id}${suffix}.webp`);
    if (hasTarget) await target.screenshot({ path: pngPath, animations: "disabled" });
    else await page.screenshot({ path: pngPath, fullPage: false, animations: "disabled" });
    await sharp(pngPath)
      .resize(1600, null, { withoutEnlargement: true, fit: "inside" }) // sharper than the old 1200
      .sharpen()
      .webp({ quality: SHOT_QUALITY })
      .toFile(webpPath);
    try { unlinkSync(pngPath); } catch { /* ok */ }
    console.log(`     saved ${webpPath}`);
  }
  await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  console.log(`\nCapture marketing module shots → ${OUT_DIR}\n`);

  const secret = USE_STAGING_SECRET
    ? loadSecret()
    : {
        CLERK_SECRET_KEY: process.env.CLERK_SECRET_KEY,
        NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
      };
  if (!secret.CLERK_SECRET_KEY || !secret.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) {
    console.error("Missing Clerk keys — set env or use staging secret");
    process.exit(1);
  }
  process.env.CLERK_SECRET_KEY = secret.CLERK_SECRET_KEY;
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = secret.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

  const session = await mintIosPlaywrightSession({ appUrl: BASE });
  if (session.skip) {
    console.error(session.reason);
    process.exit(1);
  }

  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const ctx = await browser.newContext({
    viewport: VIEWPORT,
    colorScheme: "dark",
  });
  ctx.setDefaultTimeout(120_000);
  ctx.setDefaultNavigationTimeout(120_000);
  await ctx.addInitScript(onboardingInitScript());
  await ctx.addCookies(session.cookies);
  const page = await ctx.newPage();

  await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.waitForTimeout(5000);
  if (await hasErrorPage(page)) {
    console.error("Dashboard error — try CAPTURE_BASE_URL=https://blackouttrades.com with prod Clerk keys");
    process.exit(1);
  }
  console.log("Auth OK\n");

  for (const mod of MODULES) {
    await captureModule(page, mod);
  }

  await ctx.close();
  await browser.close();
  try {
    await session.cleanup?.();
  } catch {
    /* best-effort */
  }
  console.log("\nDone.\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
