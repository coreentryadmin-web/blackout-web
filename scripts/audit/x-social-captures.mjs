/**
 * Playwright capture helpers for X marketing — every major Thermal + Helix panel.
 * Used by scripts/audit/x-social-drafts.mjs
 */
import { assertCapturableUrl } from "@/lib/x-intel/capture-guard";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function dismissOverlays(page) {
  for (const sel of [
    'button:has-text("SKIP")',
    'button:has-text("Got it")',
    '[aria-label="Close"]',
    '.helix-analytics-overlay button[aria-label="Close"]',
    '.helix-analytics-overlay [data-modal-close]',
  ]) {
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
  await page.keyboard.press("Escape").catch(() => {});
}

export async function warmThermalChain(page, sym) {
  await page.evaluate(async (t) => {
    await fetch(`/api/market/gex-heatmap?ticker=${encodeURIComponent(t)}&force=1`, {
      credentials: "include",
    });
  }, sym);
}

function thermalUrl(base, { ticker = "SPY", lens = "gex", compare = false, compareSet = "mega" }) {
  const p = new URLSearchParams();
  p.set("ticker", ticker);
  p.set("lens", lens);
  if (compare) {
    p.set("compare", "1");
    p.set("compareSet", compareSet);
  }
  return `${base}/heatmap?${p.toString()}`;
}

export async function navigateThermal(page, base, opts) {
  const url = thermalUrl(base, opts);
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await dismissOverlays(page);
  await page.waitForSelector(".gex-heatmap-desk", { timeout: 60_000 });
  await sleep(2000);

  if (!opts.compare && opts.ticker) {
    await warmThermalChain(page, opts.ticker);
    const chip = page.locator('button[aria-label*="Change ticker"]').first();
    const chipText = ((await chip.textContent()) ?? "").toUpperCase();
    if (!chipText.includes(opts.ticker.toUpperCase())) {
      await chip.click();
      const search = page.locator('input[aria-label="Search any ticker"]').first();
      await search.waitFor({ state: "visible", timeout: 15_000 });
      await search.fill(opts.ticker);
      await sleep(1200);
      const option = page.locator("#ticker-listbox button").filter({ hasText: opts.ticker }).first();
      if (await option.count()) await option.click();
      else await search.press("Enter");
      await sleep(5000);
    }
  }

  if (opts.compare) {
    const gridBtn = page.locator("button.thermal-grid-toolbar-toggle").first();
    const pressed = await gridBtn.getAttribute("aria-pressed");
    if (pressed !== "true") {
      await gridBtn.click();
      await sleep(800);
    }
    if (opts.compareSet && opts.compareSet !== "mega") {
      await page.locator('button[aria-label="Sector compare preset"]').first().click();
      await sleep(400);
      const label =
        {
          mega: "Mag 7",
          semis: "Semis",
          indices: "Indices",
          ai: "AI",
          space: "Space",
          crypto: "Crypto",
          energy: "Energy",
          financials: "Financials",
          healthcare: "Healthcare",
          macro: "Macro",
        }[opts.compareSet] ?? opts.compareSet;
      await page.locator(".thermal-grid-sector-option").filter({ hasText: label }).first().click();
      await sleep(500);
    }
    await page.waitForSelector(".thermal-triple-desk", { timeout: 90_000 });
    await sleep(8000);
    for (const sym of opts.warmTickers ?? []) {
      await warmThermalChain(page, sym);
    }
  }

  if (opts.lens && opts.lens !== "gex") {
    await page.locator(`.thermal-desk-lens-tab[data-lens="${opts.lens}"]`).first().click();
    await sleep(4000);
  }

  if (opts.pairView && opts.pairView !== "pair-a") {
    if (opts.compare) {
      const gridBtn = page.locator("button.thermal-grid-toolbar-toggle.is-on").first();
      if (await gridBtn.count()) {
        await gridBtn.click();
        await sleep(600);
      }
    }
    const tabLabel =
      opts.pairView === "pair-b"
        ? /Profile|Curve|Shift/i
        : /Forced Flow|Depth/i;
    await page.getByRole("tab", { name: tabLabel }).first().click();
    await sleep(5000);
  }

  assertCapturableUrl(page.url(), `Thermal ${opts.id ?? opts.ticker ?? opts.compareSet}`);
}

export async function shotClip(page, locator, context, maxH = 980) {
  const el = locator.first();
  await el.waitFor({ state: "visible", timeout: 45_000 });
  await el.evaluate((node) => {
    node.scrollTop = 0;
  });
  await sleep(500);
  let clip = await el.evaluate((node, h) => {
    const r = node.getBoundingClientRect();
    return {
      x: Math.max(0, Math.floor(r.x)),
      y: Math.max(0, Math.floor(r.y)),
      width: Math.min(Math.floor(r.width), 1880),
      height: Math.min(Math.floor(r.height), h),
    };
  }, maxH);
  if (clip.width < 80 || clip.height < 80) {
    const desk = page.locator(".helix-pro-desk, .helix-desk-terminal, .gex-heatmap-desk").first();
    if (await desk.isVisible().catch(() => false)) {
      clip = await desk.evaluate((node, h) => {
        const r = node.getBoundingClientRect();
        return {
          x: Math.max(0, Math.floor(r.x)),
          y: Math.max(0, Math.floor(r.y)),
          width: Math.min(Math.floor(r.width), 1880),
          height: Math.min(Math.floor(r.height), h),
        };
      }, maxH);
    }
  }
  assertCapturableUrl(page.url(), context);
  return page.screenshot({ type: "png", animations: "disabled", clip });
}

export async function captureThermalShot(page, base, shot) {
  await navigateThermal(page, base, shot);
  if (shot.compare) {
    return shotClip(page, page.locator(".thermal-desk-capture-root, .thermal-triple-desk"), shot.id, 1000);
  }
  return shotClip(page, page.locator(".thermal-desk-capture-root, .gex-heatmap-desk"), shot.id, 980);
}

export async function navigateHelix(page, base, opts) {
  await page.goto(`${base}/flows`, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await dismissOverlays(page);
  await sleep(2500);
  await page.waitForSelector("#helix-ticker-search, .helix-pro-desk, .helix-desk-terminal", {
    timeout: 60_000,
  });

  if (opts.ticker) {
    const search = page.locator("#helix-ticker-search, input[aria-label*='Ticker']").first();
    await search.waitFor({ state: "visible", timeout: 30_000 });
    await search.click({ timeout: 10_000 });
    await search.fill("");
    await search.pressSequentially(opts.ticker, { delay: 40 });
    await search.press("Enter").catch(() => search.press("Tab"));
    await sleep(4500);
  }

  if (opts.dte0) {
    const chip = page.getByRole("button", { name: "0DTE", exact: true }).first();
    if (await chip.count()) {
      await chip.click();
      await sleep(2500);
    }
  }

  if (opts.whales) {
    const whales = page.getByRole("button", { name: "Whales", exact: true }).first();
    if (await whales.count()) {
      const pressed = await whales.getAttribute("aria-pressed");
      if (pressed !== "true") {
        await whales.click();
        await sleep(2500);
      }
    }
  }

  const analyticsBtn = page.getByRole("button", { name: /Analytics|Hide analytics/i }).first();
  if (opts.analytics) {
    const label = (await analyticsBtn.textContent()) ?? "";
    if (/hide/i.test(label)) {
      /* already open */
    } else if (await analyticsBtn.count()) {
      await analyticsBtn.click();
      await sleep(3000);
    }
  } else if (await analyticsBtn.count()) {
    const label = (await analyticsBtn.textContent()) ?? "";
    if (/hide/i.test(label)) {
      await analyticsBtn.click();
      await sleep(800);
    }
  }

  await sleep(2000);
  assertCapturableUrl(page.url(), `Helix ${opts.id ?? opts.ticker ?? "market"}`);
}

export async function captureHelixShot(page, base, shot) {
  await navigateHelix(page, base, shot);
  if (shot.clip === "rail") {
    const rail = page.locator(".helix-desk-analytics-rail").first();
    await rail.waitFor({ state: "visible", timeout: 30_000 });
    return shotClip(page, rail, shot.id, 920);
  }
  if (shot.clip === "net-premium") {
    const panel = page.locator(".helix-pro-rail-panel").filter({ hasText: "Net Premium" }).first();
    await panel.waitFor({ state: "visible", timeout: 30_000 });
    await panel.scrollIntoViewIfNeeded();
    await sleep(800);
    return shotClip(page, panel, shot.id, 640);
  }
  if (shot.clip === "analytics-wide") {
    return shotClip(page, page.locator(".helix-pro-desk, .helix-desk-terminal"), shot.id, 920);
  }
  return shotClip(page, page.locator(".helix-desk-terminal, .helix-pro-desk"), shot.id, 920);
}

/** Every panel worth posting — ids stable for manifest + POSTS.md */
export const THERMAL_SHOTS = [
  { id: "matrix-gex-tsla", label: "TSLA GEX matrix", ticker: "TSLA", lens: "gex" },
  { id: "matrix-gex-spx", label: "SPX GEX matrix", ticker: "SPX", lens: "gex" },
  { id: "matrix-vex-spy", label: "SPY VEX matrix", ticker: "SPY", lens: "vex" },
  { id: "matrix-dex-nvda", label: "NVDA DEX matrix", ticker: "NVDA", lens: "dex" },
  { id: "grid-mag7", label: "Mag 7 compare grid", compare: true, compareSet: "mega", warmTickers: ["NVDA", "TSLA"] },
  { id: "grid-semis", label: "Semis compare grid", compare: true, compareSet: "semis", warmTickers: ["NVDA", "AMD"] },
  { id: "grid-indices", label: "Indices compare grid", compare: true, compareSet: "indices", warmTickers: ["SPY", "SPX"] },
  { id: "grid-ai", label: "AI infra compare grid", compare: true, compareSet: "ai", warmTickers: ["PLTR"] },
  { id: "grid-macro", label: "Macro compare grid", compare: true, compareSet: "macro", warmTickers: ["TLT", "GLD"] },
  { id: "profile-curve-spy", label: "SPY gamma profile + curve", ticker: "SPY", lens: "gex", pairView: "pair-b" },
  { id: "depth-ladder-spx", label: "SPX forced-flow depth", ticker: "SPX", lens: "gex", pairView: "pair-c" },
];

export const HELIX_SHOTS = [
  { id: "tape-tsla", label: "TSLA flow tape", ticker: "TSLA", analytics: false },
  { id: "tape-spx-whales", label: "SPX whale tape", ticker: "SPX", whales: true, analytics: false },
  { id: "tape-spx-0dte", label: "SPX 0DTE tape", ticker: "SPX", dte0: true, analytics: false },
  { id: "desk-analytics-market", label: "Market desk + analytics rail", analytics: true },
  { id: "analytics-net-premium", label: "Net premium leaderboard", analytics: true, clip: "net-premium" },
  { id: "analytics-rail-spx", label: "SPX conviction + net premium rail", ticker: "SPX", analytics: true, clip: "rail" },
];
