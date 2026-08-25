/**
 * Playwright capture helpers for X marketing — full platform panel catalog.
 * Thermal · Helix · Vector · Largo · Meridian · SPX Slayer · Night Hawk
 * Used by scripts/audit/x-social-drafts.mjs
 */
import { assertCapturableUrl } from "@/lib/x-intel/capture-guard";
import { THERMAL_COMPARE_PRESETS } from "@/features/thermal/lib/thermal-compare-presets";

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

  if (opts.indicesOnly) {
    const indices = page.getByRole("button", { name: "Indices", exact: true }).first();
    if (await indices.count()) {
      const pressed = await indices.getAttribute("aria-pressed");
      if (pressed !== "true") {
        await indices.click();
        await sleep(2500);
      }
    }
  }

  if (opts.minPremium != null) {
    const label =
      opts.minPremium >= 1_000_000
        ? `$${opts.minPremium / 1_000_000}M`
        : `$${opts.minPremium / 1000}K`;
    const floorBtn = page.locator(".helix-tape-seg--floor button").filter({ hasText: label }).first();
    if (await floorBtn.count()) {
      await floorBtn.click();
      await sleep(2000);
    }
  }

  if (opts.side && opts.side !== "ALL") {
    const sideBtn = page.locator(".helix-tape-seg-btn").filter({ hasText: opts.side }).first();
    if (await sideBtn.count()) {
      await sideBtn.click();
      await sleep(2000);
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

  if (opts.morePanels && opts.analytics) {
    const moreBtn = page.getByRole("button", { name: /More panels/i }).first();
    if (await moreBtn.count()) {
      await moreBtn.click();
      await sleep(3500);
    }
  }

  await sleep(2000);
  assertCapturableUrl(page.url(), `Helix ${opts.id ?? opts.ticker ?? "market"}`);
}

export async function captureHelixShot(page, base, shot) {
  await navigateHelix(page, base, shot);
  if (shot.clip === "overlay") {
    const overlay = page.locator(".helix-analytics-overlay-grid, .helix-analytics-overlay").first();
    await overlay.waitFor({ state: "visible", timeout: 30_000 });
    return shotClip(page, overlay, shot.id, 920);
  }
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

const GRID_WARM = {
  mega: ["NVDA", "TSLA"],
  semis: ["NVDA", "AMD"],
  indices: ["SPY", "SPX"],
  ai: ["PLTR"],
  macro: ["TLT", "GLD"],
  space: ["RKLB", "ASTS"],
  crypto: ["COIN", "MSTR"],
  energy: ["XOM", "CVX"],
  financials: ["JPM", "GS"],
  healthcare: ["LLY", "UNH"],
};

function thermalGridShots() {
  return THERMAL_COMPARE_PRESETS.map((p) => ({
    id: `grid-${p.id === "mega" ? "mag7" : p.id}`,
    label: `${p.label} compare grid`,
    compare: true,
    compareSet: p.id,
    warmTickers: GRID_WARM[p.id] ?? [p.tickers[0]],
  }));
}

/** Every Thermal panel worth posting */
export const THERMAL_SHOTS = [
  { id: "matrix-gex-tsla", label: "TSLA GEX matrix", ticker: "TSLA", lens: "gex" },
  { id: "matrix-gex-spx", label: "SPX GEX matrix", ticker: "SPX", lens: "gex" },
  { id: "matrix-gex-nvda", label: "NVDA GEX matrix", ticker: "NVDA", lens: "gex" },
  { id: "matrix-vex-spy", label: "SPY VEX matrix", ticker: "SPY", lens: "vex" },
  { id: "matrix-dex-nvda", label: "NVDA DEX matrix", ticker: "NVDA", lens: "dex" },
  { id: "matrix-charm-spy", label: "SPY CHARM matrix", ticker: "SPY", lens: "charm" },
  ...thermalGridShots(),
  { id: "profile-curve-spy", label: "SPY gamma profile + curve", ticker: "SPY", lens: "gex", pairView: "pair-b" },
  { id: "depth-ladder-spx", label: "SPX forced-flow depth", ticker: "SPX", lens: "gex", pairView: "pair-c" },
];

/** Helix tape + analytics combinations */
export const HELIX_SHOTS = [
  { id: "tape-tsla", label: "TSLA flow tape", ticker: "TSLA", analytics: false },
  { id: "tape-nvda", label: "NVDA flow tape", ticker: "NVDA", analytics: false },
  { id: "tape-spx-whales", label: "SPX whale tape", ticker: "SPX", whales: true, analytics: false },
  { id: "tape-spx-0dte", label: "SPX 0DTE tape", ticker: "SPX", dte0: true, analytics: false },
  { id: "tape-indices", label: "Indices-only tape", indicesOnly: true, analytics: false },
  { id: "tape-1m-floor", label: "$1M+ floor tape", minPremium: 1_000_000, analytics: false },
  { id: "tape-calls-only", label: "Calls-only tape", side: "CALL", analytics: false },
  { id: "desk-analytics-market", label: "Market desk + analytics rail", analytics: true },
  { id: "analytics-net-premium", label: "Net premium leaderboard", analytics: true, clip: "net-premium" },
  { id: "analytics-rail-spx", label: "SPX conviction + net premium rail", ticker: "SPX", analytics: true, clip: "rail" },
  { id: "analytics-more-panels", label: "All analytics panels overlay", analytics: true, morePanels: true, clip: "overlay" },
];

export const VECTOR_SHOTS = [
  { id: "vector-0dte-spx", label: "SPX 0DTE structure chart", ticker: "SPX" },
  { id: "vector-0dte-tsla", label: "TSLA 0DTE structure chart", ticker: "TSLA" },
  { id: "vector-0dte-nvda", label: "NVDA 0DTE structure chart", ticker: "NVDA" },
];

export const LARGO_SHOTS = [
  {
    id: "largo-tsla-gamma",
    label: "Largo · TSLA gamma read",
    question:
      "What's the TSLA gamma setup right now? Flip level, call/put walls, dealer regime, and what matters for tomorrow.",
  },
  {
    id: "largo-spx-watch",
    label: "Largo · SPX session watch",
    question: "What should I watch on SPX today — gamma flip, walls, flow, and the highest-conviction levels?",
  },
  {
    id: "largo-mag7-compare",
    label: "Largo · Mag 7 sector compare",
    question: "Compare Mag 7 dealer gamma — who's long gamma vs short gamma and where are the pin risks?",
  },
  {
    id: "largo-whale-flow",
    label: "Largo · whale flow scan",
    question: "What are the biggest whale option prints hitting the tape right now and what do they imply?",
  },
];

export const MERIDIAN_SHOTS = [
  { id: "meridian-nvda-report", label: "Meridian · NVDA earnings report", ticker: "NVDA", tab: "report" },
  { id: "meridian-nvda-positioning", label: "Meridian · NVDA positioning", ticker: "NVDA", tab: "positioning" },
  { id: "meridian-spx-macro", label: "Meridian · macro lane", filter: "macro" },
];

export const SLAYER_SHOTS = [{ id: "slayer-desk", label: "SPX Slayer play engine + GEX rail" }];

export const NIGHTHAWK_SHOTS = [
  { id: "nighthawk-0dte-deck", label: "Night Hawk 0DTE command deck", view: "ZERO_DTE" },
  { id: "nighthawk-swing-deck", label: "Night Hawk swing horizon", view: "SWING" },
  { id: "nighthawk-banger-board", label: "Night Hawk banger board", view: "BANGER" },
];

export async function captureVectorShot(page, base, shot) {
  const sym = shot.ticker ?? "SPX";
  await page.goto(`${base}/vector?ticker=${encodeURIComponent(sym)}`, {
    waitUntil: "domcontentloaded",
    timeout: 90_000,
  });
  await dismissOverlays(page);
  await page.waitForSelector(".vector-chart-wrap", { timeout: 60_000 });
  await sleep(3000);
  const dteBtn = page.locator('[data-testid="vector-dte-0dte"]').first();
  if (await dteBtn.count()) {
    await dteBtn.click();
    await sleep(4000);
  }
  const tf = page.locator("#vector-tf-select").first();
  if (await tf.count()) {
    await tf.selectOption("15").catch(() => {});
    await sleep(5000);
  }
  assertCapturableUrl(page.url(), `Vector ${sym}`);
  return shotClip(page, page.locator(".vector-chart-wrap"), shot.id, 920);
}

export async function captureLargoShot(page, base, shot) {
  await page.goto(`${base}/terminal`, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await dismissOverlays(page);
  const input = page.locator('input[aria-label="Ask Largo"], textarea[aria-label="Ask Largo"]').first();
  await input.waitFor({ state: "visible", timeout: 30_000 });
  await page.waitForFunction(
    () => {
      const el = document.querySelector('input[aria-label="Ask Largo"], textarea[aria-label="Ask Largo"]');
      return el && !el.disabled;
    },
    { timeout: 45_000 },
  );
  await input.fill(shot.question);
  await sleep(400);
  const submit = page.locator('.largo-input-form button[type="submit"]').first();
  if (await submit.count()) await submit.click();
  else await input.press("Enter");
  await page.waitForSelector(".desk-largo-assistant, .largo-msg-assistant", { timeout: 90_000 });
  await page.waitForFunction(
    () => {
      const stopBtn = document.querySelector('.largo-stop-btn, [aria-label="Stop generating"]');
      if (stopBtn && stopBtn.offsetParent !== null) return false;
      const nodes = document.querySelectorAll(".desk-largo-assistant, .largo-msg-assistant");
      const last = nodes[nodes.length - 1];
      const text = last?.textContent?.trim() ?? "";
      return text.length > 180 && !/working|pulling live|thinking/i.test(text.slice(0, 40));
    },
    { timeout: 150_000 },
  );
  await sleep(2500);
  assertCapturableUrl(page.url(), `Largo ${shot.id}`);
  return shotClip(page, page.locator(".largo-terminal-fullpage, .desk-largo-panel, main"), shot.id, 980);
}

const EARNINGS_ROW =
  ".meridian-timeline-row.meridian-theme-earnings:has(.impact-high), .meridian-timeline-row.meridian-theme-earnings:has(.impact-medium)";

export async function captureMeridianShot(page, base, shot) {
  await page.goto(`${base}/meridian`, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await dismissOverlays(page);
  await page.waitForSelector(".meridian-page-root, .meridian-desk-body", { timeout: 60_000 });
  await sleep(3000);

  if (shot.filter === "macro") {
    const macroPill = page.getByRole("tab", { name: /Macro/i }).first();
    if (await macroPill.count()) await macroPill.click();
    await sleep(2000);
    const row = page.locator(".meridian-timeline-row").first();
    if (await row.count()) await row.click();
    await sleep(4000);
  } else if (shot.ticker) {
    const search = page.locator(".meridian-search-input").first();
    await search.fill(shot.ticker);
    await sleep(2000);
    const row = page.locator(EARNINGS_ROW).filter({ hasText: shot.ticker }).first();
    if (await row.count()) {
      await row.click();
    } else {
      const lookup = page.locator(".meridian-lookup-card").first();
      if (await lookup.count()) await lookup.click();
    }
    await sleep(5000);
    if (shot.tab === "positioning") {
      await page.getByRole("tab", { name: /Positioning/i }).first().click();
      await sleep(3000);
    }
  }

  assertCapturableUrl(page.url(), `Meridian ${shot.id}`);
  return shotClip(page, page.locator(".meridian-detail-v2, .meridian-earnings-tabs, .meridian-desk-body"), shot.id, 980);
}

export async function captureSlayerShot(page, base, shot) {
  await page.goto(`${base}/dashboard`, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await dismissOverlays(page);
  await page.waitForSelector(".spx-desk, .gex-heatmap-desk, main", { timeout: 60_000 });
  await sleep(8000);
  assertCapturableUrl(page.url(), "SPX Slayer");
  return shotClip(page, page.locator(".spx-desk, main"), shot.id, 980);
}

export async function captureNighthawkShot(page, base, shot) {
  const view = shot.view ?? "ZERO_DTE";
  await page.goto(`${base}/nighthawk?view=${view.toLowerCase()}`, {
    waitUntil: "domcontentloaded",
    timeout: 90_000,
  });
  await dismissOverlays(page);
  await page.waitForSelector(".nh-v2-page, .nighthawk-content-canvas", { timeout: 60_000 });
  await sleep(view === "ZERO_DTE" ? 12_000 : 8000);
  assertCapturableUrl(page.url(), `Night Hawk ${view}`);
  return shotClip(
    page,
    page.locator(".nh-deck, .nighthawk-content-canvas, .nh-v2-page"),
    shot.id,
    980,
  );
}

/** Flat catalog grouped by product for manifest filtering */
export const ALL_PRODUCT_SHOTS = {
  thermal: THERMAL_SHOTS,
  helix: HELIX_SHOTS,
  vector: VECTOR_SHOTS,
  largo: LARGO_SHOTS,
  meridian: MERIDIAN_SHOTS,
  slayer: SLAYER_SHOTS,
  nighthawk: NIGHTHAWK_SHOTS,
};
