/**
 * Execute a capture from the visual catalog by entry id + params.
 * Used by x-social-drafts.mjs and x-content-director.mjs.
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { assertCapturableUrl } from "@/lib/x-intel/capture-guard";
import { prepareVectorSocialCapture } from "./vector-showcase-prep.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const CATALOG_PATH = join(process.cwd(), "data/x-intel/visual-capture-catalog.json");

/** Load persisted catalog JSON (run npm run x:catalog:export first). */
export function loadCaptureCatalogJson() {
  if (!existsSync(CATALOG_PATH)) {
    throw new Error(`Missing ${CATALOG_PATH} — run: npm run x:catalog:export`);
  }
  return JSON.parse(readFileSync(CATALOG_PATH, "utf8"));
}

export function findCatalogEntry(catalog, id) {
  for (const entries of Object.values(catalog.products ?? {})) {
    const hit = entries.find((e) => e.id === id);
    if (hit) return hit;
  }
  return null;
}

export function mergeParams(entry, overrides = {}) {
  const out = {};
  for (const p of entry.params ?? []) {
    if (overrides[p.key] != null) out[p.key] = overrides[p.key];
    else if (p.default != null) out[p.key] = p.default;
  }
  for (const [k, v] of Object.entries(overrides)) {
    if (v != null) out[k] = v;
  }
  return out;
}

function resolveQuestion(template, params) {
  return String(template)
    .replaceAll("{ticker}", String(params.ticker ?? "SPX"))
    .replaceAll("{strike}", String(params.strike ?? ""));
}

export async function dismissOverlays(page) {
  await sleep(800);
  for (let pass = 0; pass < 3; pass += 1) {
    for (const sel of [
      'button:has-text("Skip")',
      'button:has-text("SKIP")',
      ".onboarding-btn-ghost",
      'button:has-text("Got it")',
      '[aria-label="Close"]',
      ".helix-analytics-overlay button[aria-label='Close']",
    ]) {
      try {
        const el = page.locator(sel).first();
        if ((await el.count()) > 0 && (await el.isVisible())) {
          await el.click({ timeout: 2000 });
          await sleep(500);
        }
      } catch {
        /* ignore */
      }
    }
    await page.keyboard.press("Escape").catch(() => {});
    await sleep(400);
    const tourOpen = await page.locator(".onboarding-modal, .onboarding-title").count();
    if (!tourOpen) break;
  }
}

async function warmThermalChain(page, sym) {
  await page.evaluate(async (t) => {
    await fetch(`/api/market/gex-heatmap?ticker=${encodeURIComponent(t)}&force=1`, {
      credentials: "include",
    });
  }, sym);
}

export async function shotElement(page, selector, context) {
  const el = page.locator(selector).first();
  await el.waitFor({ state: "visible", timeout: 45_000 });
  await sleep(500);
  assertCapturableUrl(page.url(), context);
  return el.screenshot({ type: "png", animations: "disabled" });
}

export async function shotClip(page, selector, context, maxH = 980) {
  const el = page.locator(selector).first();
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
    throw new Error(`${context}: clip too small ${clip.width}x${clip.height}`);
  }
  assertCapturableUrl(page.url(), context);
  return page.screenshot({ type: "png", animations: "disabled", clip });
}

const PREMIUM_MAP = { "200k": 200_000, "500k": 500_000, "1m": 1_000_000, "20m": 20_000_000 };

async function applyHelixFilters(page, params) {
  if (params.ticker) {
    const search = page.locator("#helix-ticker-search").first();
    await search.waitFor({ state: "visible", timeout: 30_000 });
    await search.click();
    await search.fill("");
    await search.pressSequentially(String(params.ticker), { delay: 40 });
    await search.press("Enter").catch(() => search.press("Tab"));
    await sleep(4000);
  }
  if (params.dte === "0dte") {
    await page.getByRole("button", { name: "0DTE", exact: true }).first().click().catch(() => {});
    await sleep(2000);
  }
  if (params.whales === true || params.whales === "true") {
    const w = page.getByRole("button", { name: "Whales", exact: true }).first();
    if ((await w.getAttribute("aria-pressed")) !== "true") await w.click();
    await sleep(2000);
  }
  if (params.indices === true || params.indices === "true") {
    const i = page.getByRole("button", { name: "Indices", exact: true }).first();
    if ((await i.getAttribute("aria-pressed")) !== "true") await i.click();
    await sleep(2000);
  }
  if (params.min_premium && PREMIUM_MAP[params.min_premium]) {
    const label =
      params.min_premium === "1m"
        ? "$1M"
        : params.min_premium === "20m"
          ? "$20M"
          : `$${params.min_premium.replace("k", "K").toUpperCase()}`;
    await page.locator(".helix-tape-seg--floor button").filter({ hasText: label }).first().click();
    await sleep(1500);
  }
  if (params.side && params.side !== "ALL") {
    await page.locator(".helix-tape-seg-btn").filter({ hasText: params.side }).first().click();
    await sleep(1500);
  }
  const analyticsBtn = page.getByRole("button", { name: /Analytics|Hide analytics/i }).first();
  const wantAnalytics = params.analytics === true || params.analytics === "true";
  if (wantAnalytics) {
    if (!/hide/i.test((await analyticsBtn.textContent()) ?? "")) await analyticsBtn.click();
    await sleep(2500);
  } else if (await analyticsBtn.count()) {
    if (/hide/i.test((await analyticsBtn.textContent()) ?? "")) await analyticsBtn.click();
    await sleep(800);
  }
}

const EARNINGS_ROW =
  ".meridian-timeline-row.meridian-theme-earnings:has(.impact-high), .meridian-timeline-row.meridian-theme-earnings:has(.impact-medium)";

const RECIPES = {
  async thermal_matrix(page, base, entry, params) {
    const ticker = params.ticker ?? "SPY";
    const lens = params.lens ?? "gex";
    const q = new URLSearchParams({ ticker, lens });
    await page.goto(`${base}/heatmap?${q}`, { waitUntil: "domcontentloaded", timeout: 90_000 });
    await dismissOverlays(page);
    await page.waitForSelector(".gex-heatmap-desk", { timeout: 60_000 });
    await warmThermalChain(page, ticker);
    const allBtn = page.getByRole("button", { name: /^All$/i }).first();
    if (await allBtn.count()) {
      const pressed = await allBtn.getAttribute("aria-pressed");
      if (pressed !== "true") await allBtn.click();
      await sleep(2000);
    }
    if (lens !== "gex") {
      await page.locator(`.thermal-desk-lens-tab[data-lens="${lens}"]`).first().click();
      await sleep(3500);
    }
    await sleep(3000);
  },

  async thermal_profile(page, base, entry, params) {
    await RECIPES.thermal_matrix(page, base, entry, { ...params, lens: params.lens ?? "gex" });
    await page.getByRole("tab", { name: /Profile|Curve|Shift/i }).first().click();
    await sleep(5000);
  },

  async thermal_depth(page, base, entry, params) {
    await RECIPES.thermal_matrix(page, base, entry, { ...params, lens: "gex" });
    await page.getByRole("tab", { name: /Forced Flow|Depth/i }).first().click();
    await sleep(5000);
  },

  async thermal_grid(page, base, entry, params) {
    const preset = params.compare_set ?? "semis";
    const labels = {
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
    };
    const q = new URLSearchParams({ ticker: "SPY", lens: "gex", compare: "1", compareSet: preset });
    await page.goto(`${base}/heatmap?${q}`, { waitUntil: "domcontentloaded", timeout: 90_000 });
    await dismissOverlays(page);
    const gridBtn = page.locator("button.thermal-grid-toolbar-toggle").first();
    if ((await gridBtn.getAttribute("aria-pressed")) !== "true") await gridBtn.click();
    if (preset !== "mega") {
      await page.locator('button[aria-label="Sector compare preset"]').first().click();
      await sleep(400);
      await page.locator(".thermal-grid-sector-option").filter({ hasText: labels[preset] ?? preset }).first().click();
    }
    await page.waitForSelector(".thermal-triple-desk", { timeout: 90_000 });
    await sleep(8000);
  },

  async helix_tape(page, base, entry, params) {
    await page.goto(`${base}/flows`, { waitUntil: "domcontentloaded", timeout: 90_000 });
    await dismissOverlays(page);
    await page.waitForSelector(".helix-pro-desk", { timeout: 60_000 });
    await applyHelixFilters(page, params);
    await sleep(2000);
  },

  async helix_analytics_rail(page, base, entry, params) {
    await RECIPES.helix_tape(page, base, entry, { ...params, analytics: true });
  },

  async helix_net_premium(page, base, entry, params) {
    await RECIPES.helix_tape(page, base, entry, { analytics: true });
  },

  async helix_top_prints(page, base, entry, params) {
    await RECIPES.helix_tape(page, base, entry, { ...params, analytics: true });
  },

  async helix_top_strikes(page, base, entry, params) {
    await RECIPES.helix_tape(page, base, entry, { ...params, analytics: true });
  },

  async helix_analytics_overlay(page, base, entry, params) {
    await RECIPES.helix_tape(page, base, entry, { analytics: true });
    await page.getByRole("button", { name: /More panels/i }).first().click();
    await sleep(3500);
  },

  async helix_contract_drilldown(page, base, entry, params) {
    await RECIPES.helix_tape(page, base, entry, params);
    const row = page.locator(".helix-flow-table tbody tr, .helix-desk-tape-col tr").first();
    await row.click();
    await sleep(3000);
  },

  async helix_ticker_drawer(page, base, entry, params) {
    await RECIPES.helix_tape(page, base, entry, params);
    const symCell = page.locator(".helix-flow-table tbody tr td").first();
    await symCell.click();
    await sleep(3000);
  },

  async vector_desk(page, base, entry, params) {
    const ticker = params.ticker ?? "SPX";
    const horizon = params.horizon ?? "0dte";
    await page.goto(`${base}/vector?ticker=${encodeURIComponent(ticker)}`, {
      waitUntil: "domcontentloaded",
      timeout: 90_000,
    });
    await dismissOverlays(page);
    await page.waitForSelector(".vector-chart-wrap", { timeout: 60_000 });
    await prepareVectorSocialCapture(page, {
      horizon,
      timeframe: params.timeframe ?? "3",
      nodes: params.nodes ?? "20",
      zoom: params.zoom,
      zoomAnchor: params.zoom_anchor,
      priceZoom: params.price_zoom,
      sessionViewport: params.session_viewport === true || params.session_viewport === "true",
      waitBeads: params.wait_beads === true || params.wait_beads === "true",
    });
    await dismissOverlays(page);
  },

  async vector_fullscreen(page, base, entry, params) {
    await RECIPES.vector_desk(page, base, entry, params);
    await page.getByRole("button", { name: /Full screen/i }).first().click().catch(() => {});
    await sleep(3000);
  },

  async vector_compare(page, base, entry, params) {
    await page.goto(`${base}/vector`, { waitUntil: "domcontentloaded", timeout: 90_000 });
    await dismissOverlays(page);
    await page.getByRole("button", { name: /Compare/i }).first().click();
    await sleep(5000);
  },

  async largo_answer(page, base, entry, params) {
    const question = resolveQuestion(params.question ?? entry.params?.find((p) => p.key === "question")?.default ?? "", params);
    await page.goto(`${base}/terminal`, { waitUntil: "domcontentloaded", timeout: 90_000 });
    await dismissOverlays(page);
    const input = page.locator('input[aria-label="Ask Largo"], textarea[aria-label="Ask Largo"]').first();
    await input.waitFor({ state: "visible", timeout: 30_000 });
    await input.fill(question);
    await page.locator('.largo-input-form button[type="submit"]').first().click().catch(() => input.press("Enter"));
    await page.waitForSelector(".desk-largo-assistant, .largo-msg-assistant", { timeout: 90_000 });
    await page.waitForFunction(
      () => {
        const stopBtn = document.querySelector('.largo-stop-btn, [aria-label="Stop generating"]');
        if (stopBtn && stopBtn.offsetParent !== null) return false;
        const nodes = document.querySelectorAll(".desk-largo-assistant, .largo-msg-assistant");
        const last = nodes[nodes.length - 1];
        return (last?.textContent?.trim().length ?? 0) > 180;
      },
      { timeout: 150_000 },
    );
    await sleep(2500);
  },

  async meridian_event_tab(page, base, entry, params) {
    await page.goto(`${base}/meridian`, { waitUntil: "domcontentloaded", timeout: 90_000 });
    await dismissOverlays(page);
    await page.waitForSelector(".meridian-page-root", { timeout: 60_000 });
    const ticker = params.ticker ?? "NVDA";
    await page.locator(".meridian-search-input").first().fill(ticker);
    await sleep(2000);
    const row = page.locator(EARNINGS_ROW).filter({ hasText: ticker }).first();
    if (await row.count()) await row.click();
    else await page.locator(".meridian-lookup-card").first().click().catch(() => {});
    await sleep(5000);
    const tab = params.tab ?? "report";
    const tabLabel = tab.charAt(0).toUpperCase() + tab.slice(1);
    await page.getByRole("tab", { name: new RegExp(tabLabel, "i") }).first().click();
    await sleep(3000);
  },

  async meridian_analytics_panel(page, base, entry, params) {
    await page.goto(`${base}/meridian?view=analytics`, { waitUntil: "domcontentloaded", timeout: 90_000 });
    await dismissOverlays(page);
    await page.waitForSelector(".meridian-page-root", { timeout: 60_000 });
    await page.waitForSelector(".meridian-earnings-analytics, .meridian-analytics-grid", { timeout: 60_000 }).catch(async () => {
      await page.getByRole("tab", { name: /Analytics grid/i }).click();
    });
    await sleep(6000);
    const panel =
      params.panel ??
      entry.params?.find((p) => p.key === "panel")?.default ??
      "high_impact";
    const panelSelectors = {
      high_impact: '.meridian-analytics-grid[aria-label="High impact catalyst grid"]',
      megacap_week: ".meridian-earnings-week",
      next_24h: ".meridian-earnings-analytics .meridian-mea-split",
      surprise_scatter: '.meridian-data-card:has-text("Surprise map")',
      calendar_heat: '.meridian-data-card:has-text("Print calendar")',
      earnings_pulse: ".meridian-earnings-analytics",
      revision_timeline: ".meridian-earnings-revisions",
      after_hours: ".meridian-after-hours",
    };
    const sel = panelSelectors[panel] ?? panelSelectors.high_impact;
    const target = page.locator(sel).first();
    await target.waitFor({ state: "visible", timeout: 45_000 });
    await target.scrollIntoViewIfNeeded();
    await sleep(1500);
  },

  async meridian_macro_report(page, base, entry, params) {
    await page.goto(`${base}/meridian`, { waitUntil: "domcontentloaded", timeout: 90_000 });
    await dismissOverlays(page);
    await page.getByRole("tab", { name: /Macro/i }).first().click();
    await sleep(2000);
    await page.locator(".meridian-timeline-row").first().click();
    await sleep(4000);
  },

  async meridian_timeline(page, base, entry, params) {
    await page.goto(`${base}/meridian`, { waitUntil: "domcontentloaded", timeout: 90_000 });
    await dismissOverlays(page);
    await sleep(3000);
  },

  async slayer_desk(page, base, entry, params) {
    await page.goto(`${base}/dashboard`, { waitUntil: "domcontentloaded", timeout: 90_000 });
    await dismissOverlays(page);
    await sleep(8000);
  },

  async slayer_pin_forecaster(page, base, entry, params) {
    await RECIPES.slayer_desk(page, base, entry, params);
    await page.getByRole("button", { name: /Why this pin/i }).first().click().catch(() => {});
    await sleep(2000);
  },

  async slayer_largo_tab(page, base, entry, params) {
    await RECIPES.slayer_desk(page, base, entry, params);
    await page.getByRole("tab", { name: /Largo/i }).first().click().catch(() => {});
    await sleep(3000);
  },

  async nighthawk_deck(page, base, entry, params) {
    const view = params.view ?? "ZERO_DTE";
    await page.goto(`${base}/nighthawk?view=${String(view).toLowerCase()}`, {
      waitUntil: "domcontentloaded",
      timeout: 90_000,
    });
    await dismissOverlays(page);
    await page.waitForSelector(".nighthawk-content-canvas", { timeout: 60_000 });
    await sleep(view === "ZERO_DTE" ? 12_000 : 8000);
  },

  async nighthawk_play_panel(page, base, entry, params) {
    await RECIPES.nighthawk_deck(page, base, entry, { view: "ZERO_DTE" });
    const ticker = params.ticker ?? "SPX";
    const card = page.locator(".nh-deck-rows").filter({ hasText: ticker }).first();
    if (await card.count()) await card.click();
    await sleep(2000);
    const panel = params.panel ?? "thesis";
    await page.getByRole("tab", { name: new RegExp(panel, "i") }).first().click().catch(() => {});
    await sleep(2000);
  },
};

/**
 * Capture one catalog entry → PNG buffer.
 * @param {import('playwright').Page} page
 * @param {string} base
 * @param {object} entry — catalog entry
 * @param {object} paramOverrides
 */
export async function captureFromCatalogEntry(page, base, entry, paramOverrides = {}) {
  const params = mergeParams(entry, paramOverrides);
  const recipe = RECIPES[entry.recipe];
  if (!recipe) throw new Error(`Unknown recipe: ${entry.recipe}`);
  await recipe(page, base, entry, params);
  assertCapturableUrl(page.url(), entry.id);
  const maxH = entry.clip?.max_height ?? 980;
  const selector = entry.clip?.selector ?? "main";
  if (entry.recipe === "helix_net_premium") {
    return shotClip(page, '.helix-pro-rail-panel:has-text("Net Premium")', entry.id, maxH);
  }
  if (entry.recipe === "vector_desk") {
    // Clip caps crop the canvas wrong on Vector — full stage (candles + beads + vol) only.
    return shotElement(page, ".vector-chart-stage", entry.id);
  }
  if (entry.recipe === "meridian_analytics_panel") {
    const panel =
      params.panel ??
      entry.params?.find((p) => p.key === "panel")?.default ??
      "high_impact";
    const panelSelectors = {
      high_impact: '.meridian-analytics-grid[aria-label="High impact catalyst grid"]',
      megacap_week: ".meridian-earnings-week",
      next_24h: ".meridian-earnings-analytics .meridian-mea-split",
      surprise_scatter: '.meridian-data-card:has-text("Surprise map")',
      calendar_heat: '.meridian-data-card:has-text("Print calendar")',
      earnings_pulse: ".meridian-earnings-analytics",
      revision_timeline: ".meridian-earnings-revisions",
    };
    const sel = panelSelectors[panel] ?? panelSelectors.high_impact;
    return shotClip(page, sel, entry.id, maxH);
  }
  return shotClip(page, selector, entry.id, maxH);
}

/**
 * Capture by catalog id (loads JSON catalog).
 */
export async function captureByCatalogId(page, base, catalogId, paramOverrides = {}, catalog = null) {
  const cat = catalog ?? loadCaptureCatalogJson();
  const entry = findCatalogEntry(cat, catalogId);
  if (!entry) throw new Error(`Catalog entry not found: ${catalogId}`);
  return captureFromCatalogEntry(page, base, entry, paramOverrides);
}
