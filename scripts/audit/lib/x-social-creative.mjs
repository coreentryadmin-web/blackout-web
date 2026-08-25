/**
 * Creative X post composer — picks hot tickers, rotates panels/tabs across ALL desks,
 * and builds copy from live flow + gamma data. Never the same four screenshots twice.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

const CREATIVE_STATE_PATH = join(process.cwd(), "data/x-intel/creative-rotation.json");

const TICKERS = ["SPX", "NVDA", "TSLA", "META", "AAPL", "AMZN", "QQQ", "SPY", "COIN", "LLY", "IWM"];

/** Shot pools grouped by product family — each entry is a capturable catalog id. */
export const CREATIVE_POOLS = {
  thermal_matrix: {
    product: "Thermal",
    kind: "matrix lens",
    shots: [
      { id: "thermal.matrix.spx.gex", label: "SPX GEX matrix", ticker: "SPX", lens: "gex" },
      { id: "thermal.matrix.spx.vex", label: "SPX VEX matrix", ticker: "SPX", lens: "vex" },
      { id: "thermal.matrix.spx.dex", label: "SPX DEX matrix", ticker: "SPX", lens: "dex" },
      { id: "thermal.matrix.spx.charm", label: "SPX CHARM matrix", ticker: "SPX", lens: "charm" },
      { id: "thermal.matrix.nvda.gex", label: "NVDA GEX", ticker: "NVDA", lens: "gex" },
      { id: "thermal.matrix.nvda.vex", label: "NVDA VEX", ticker: "NVDA", lens: "vex" },
      { id: "thermal.matrix.nvda.dex", label: "NVDA DEX", ticker: "NVDA", lens: "dex" },
      { id: "thermal.matrix.tsla.vex", label: "TSLA VEX", ticker: "TSLA", lens: "vex" },
      { id: "thermal.matrix.meta.charm", label: "META CHARM", ticker: "META", lens: "charm" },
      { id: "thermal.matrix.qqq.dex", label: "QQQ DEX", ticker: "QQQ", lens: "dex" },
      { id: "thermal.matrix.iwm.gex", label: "IWM GEX", ticker: "IWM", lens: "gex" },
    ],
  },
  thermal_breadth: {
    product: "Thermal",
    kind: "sector / profile",
    shots: [
      { id: "thermal.sector_grid.semis", label: "Semis sector grid" },
      { id: "thermal.sector_grid.ai", label: "AI sector grid" },
      { id: "thermal.sector_grid.space", label: "Space sector grid" },
      { id: "thermal.sector_grid.crypto", label: "Crypto sector grid" },
      { id: "thermal.sector_grid.financials", label: "Financials sector grid" },
      { id: "thermal.sector_grid.healthcare", label: "Healthcare sector grid" },
      { id: "thermal.sector_grid.energy", label: "Energy sector grid" },
      { id: "thermal.sector_grid.macro", label: "Macro sector grid" },
      { id: "thermal.gamma_profile", label: "Gamma profile curve", ticker: "SPY" },
      { id: "thermal.forced_flow", label: "Forced-flow depth ladder", ticker: "SPY" },
    ],
  },
  helix_tape: {
    product: "Helix",
    kind: "flow tape filter",
    shots: (t) => [
      { id: `helix.tape.${t}.whales`, label: `${t} whale tape`, ticker: t },
      { id: `helix.tape.${t}.0dte`, label: `${t} 0DTE tape`, ticker: t },
      { id: `helix.tape.${t}.1m`, label: `${t} $1M+ tape`, ticker: t },
      { id: `helix.tape.${t}.calls`, label: `${t} call-side tape`, ticker: t },
      { id: `helix.tape.${t}.puts`, label: `${t} put-side tape`, ticker: t },
      { id: `helix.tape.${t}.indices`, label: `${t} indices tape`, ticker: t },
    ],
  },
  helix_analytics: {
    product: "Helix",
    kind: "analytics panel",
    shots: [
      { id: "helix.analytics_panels", label: "Analytics panels grid" },
      { id: "helix.net_premium", label: "Net premium rail" },
      { id: "helix.top_prints", label: "Top prints overlay" },
      { id: "helix.top_strikes", label: "Top strikes ladder" },
      { id: "helix.analytics_rail.market", label: "Market analytics rail" },
      { id: "helix.contract_drilldown", label: "Contract drilldown" },
      { id: "helix.ticker_drawer", label: "Ticker flow drawer", ticker: "NVDA" },
    ],
  },
  meridian_event: {
    product: "Meridian",
    kind: "earnings event tab",
    shots: (t) => [
      { id: `meridian.event.${t}.positioning`, label: `${t} positioning tab`, ticker: t, params: { tab: "positioning" } },
      { id: `meridian.event.${t}.report`, label: `${t} report tab`, ticker: t, params: { tab: "report" } },
      { id: `meridian.event.${t}.estimates`, label: `${t} estimates tab`, ticker: t, params: { tab: "estimates" } },
      { id: `meridian.event.${t}.history`, label: `${t} history tab`, ticker: t, params: { tab: "history" } },
      { id: `meridian.event.${t}.summary`, label: `${t} summary tab`, ticker: t, params: { tab: "summary" } },
    ],
  },
  meridian_analytics: {
    product: "Meridian",
    kind: "analytics grid section",
    shots: [
      { id: "meridian.surprise_scatter", label: "Surprise scatter map", params: { panel: "surprise_scatter" } },
      { id: "meridian.calendar_heat", label: "Print calendar heat", params: { panel: "calendar_heat" } },
      { id: "meridian.megacap_week", label: "Mega-cap earnings week", params: { panel: "megacap_week" } },
      { id: "meridian.next_24h", label: "Next 24h print clock", params: { panel: "next_24h" } },
      { id: "meridian.revision_timeline", label: "Estimate revisions", params: { panel: "revision_timeline" } },
      { id: "meridian.high_impact_grid", label: "High-impact catalyst grid", params: { panel: "high_impact" } },
      { id: "meridian.after_hours", label: "After-hours reaction strip", params: { panel: "after_hours" } },
      { id: "meridian.macro_report", label: "Macro report desk", params: { event: "CPI" } },
    ],
  },
  vector: {
    product: "Vector",
    kind: "chart desk",
    shots: (t) => [
      { id: `vector.desk.${t}.0dte.15m`, label: `${t} 0DTE 15m chart`, ticker: t },
      { id: `vector.desk.${t}.0dte.5m`, label: `${t} 0DTE 5m chart`, ticker: t },
      { id: `vector.desk.${t}.weekly.15m`, label: `${t} weekly structure`, ticker: t },
      { id: "vector.compare.mag7", label: "Mag7 compare quad", params: { preset: "mag7" } },
      { id: "vector.fullscreen.spx", label: "SPX fullscreen chart", ticker: "SPX" },
    ],
  },
  nighthawk: {
    product: "Night Hawk",
    kind: "0DTE deck panel",
    shots: [
      { id: "nighthawk.deck.zero_dte", label: "0DTE play deck" },
      { id: "nighthawk.deck.swing", label: "Swing lane deck" },
      { id: "nighthawk.deck.banger", label: "Banger lane deck" },
      { id: "nighthawk.closed_winners", label: "Closed winners rail" },
      { id: "nighthawk.play.thesis", label: "Play thesis panel", params: { ticker: "NVDA", panel: "thesis" } },
      { id: "nighthawk.play.management", label: "Play management tab", params: { ticker: "TSLA", panel: "management" } },
      { id: "nighthawk.play.pnl", label: "Play P&L excursion", params: { ticker: "SPX", panel: "pnl" } },
    ],
  },
  slayer: {
    product: "SPX Slayer",
    kind: "index desk panel",
    shots: [
      { id: "spx_slayer.gex_rail", label: "0DTE GEX matrix rail", params: { lens: "gex" } },
      { id: "spx_slayer.header_stats", label: "Header stats strip" },
      { id: "spx_slayer.pin_forecaster", label: "Pin forecaster panel" },
      { id: "spx_slayer.largo_read", label: "Slayer Largo tab" },
      { id: "spx_slayer.desk", label: "Full SPX Slayer desk" },
    ],
  },
  largo: {
    product: "Largo",
    kind: "AI reconcile",
    shots: (t) => [
      {
        id: "largo.flow_why",
        label: "Flow why",
        params: { ticker: t, question: `Why is ${t} seeing this flow — who's paying up and what does dealer positioning imply?` },
      },
      {
        id: "largo.gamma_read",
        label: "Gamma read",
        params: { ticker: t, question: `What's the ${t} gamma setup — flip, walls, regime, and the one level that matters?` },
      },
      {
        id: "largo.conflict",
        label: "Systems disagree",
        params: { ticker: t, question: `Helix and Thermal disagree on ${t} — reconcile the flow vs gamma read.` },
      },
      {
        id: "largo.wall_weak",
        label: "Wall test",
        params: { ticker: t, strike: "7800", question: `Is the wall on ${t} actually weakening or just being tested?` },
      },
      { id: "largo.spx_shift", label: "SPX 15m shift", params: { ticker: "SPX", question: "What changed in SPX in the last 15 minutes — gamma, flow, and levels?" } },
      { id: "largo.board_best", label: "Strongest board setup", params: { question: "What's the strongest setup on the board right now and why?" } },
    ],
  },
};

/** Family combos — each post pulls ONE shot from each family in the combo (4 different products). */
export const FAMILY_COMBOS = [
  ["thermal_breadth", "helix_analytics", "meridian_analytics", "largo"],
  ["thermal_matrix", "helix_tape", "meridian_event", "vector"],
  ["thermal_matrix", "helix_analytics", "nighthawk", "largo"],
  ["thermal_breadth", "helix_tape", "meridian_analytics", "slayer"],
  ["vector", "helix_analytics", "meridian_event", "largo"],
  ["thermal_matrix", "nighthawk", "meridian_analytics", "largo"],
  ["thermal_breadth", "helix_tape", "slayer", "largo"],
  ["thermal_matrix", "helix_analytics", "meridian_event", "nighthawk"],
  ["vector", "helix_tape", "meridian_analytics", "slayer"],
  ["thermal_breadth", "helix_analytics", "vector", "largo"],
];

export const COPY_OPENERS = [
  "Different panels today — not matrix + tape.",
  "Four tabs you don't see on every post.",
  "Rotating desks — live numbers, different lenses.",
  "Today's stack: breadth + flow + catalyst + reconcile.",
  "Not the usual screenshot carousel.",
  "Cross-product read — four unrelated panels.",
  "Pulled four different tabs off the desk.",
  "Live data · different surface each attachment.",
];

function lruPick(items, recent, keyFn) {
  const lastUsed = (item) => {
    const k = keyFn(item);
    const i = recent.indexOf(k);
    return i === -1 ? Number.POSITIVE_INFINITY : i;
  };
  return [...items].sort((a, b) => {
    const d = lastUsed(b) - lastUsed(a);
    if (d !== 0) return d;
    return items.indexOf(a) - items.indexOf(b);
  })[0];
}

function loadCreativeState() {
  if (!existsSync(CREATIVE_STATE_PATH)) {
    return { recent_combos: [], recent_shots: [], recent_openers: [] };
  }
  try {
    return JSON.parse(readFileSync(CREATIVE_STATE_PATH, "utf8"));
  } catch {
    return { recent_combos: [], recent_shots: [], recent_openers: [] };
  }
}

function saveCreativeState(state) {
  mkdirSync(dirname(CREATIVE_STATE_PATH), { recursive: true });
  writeFileSync(CREATIVE_STATE_PATH, JSON.stringify(state, null, 2));
}

function expandPoolShots(poolKey, ticker) {
  const pool = CREATIVE_POOLS[poolKey];
  const t = ticker.toLowerCase();
  const raw = typeof pool.shots === "function" ? pool.shots(t) : pool.shots;
  return raw.map((s) => ({
    ...s,
    product: pool.product,
    poolKey,
    params: { ticker: s.ticker ?? ticker.toUpperCase(), ...s.params },
  }));
}

function pickPoolShot(poolKey, ticker, recentShotIds) {
  const candidates = expandPoolShots(poolKey, ticker);
  const fresh = candidates.filter((c) => !recentShotIds.includes(c.id));
  const pool = fresh.length ? fresh : candidates;
  return lruPick(pool, recentShotIds, (s) => s.id);
}

/**
 * Compose a unique 4-shot creative pack from different product families.
 */
export function composeCreativePack(ticker = "NVDA") {
  const state = loadCreativeState();
  const recentCombos = state.recent_combos ?? [];
  const recentShots = state.recent_shots ?? [];

  const comboKeys = lruPick(FAMILY_COMBOS, recentCombos, (c) => c.join("+"));
  const comboIndex = FAMILY_COMBOS.findIndex((c) => c.join("+") === comboKeys.join("+"));

  const shots = comboKeys.map((poolKey, i) => {
    const shot = pickPoolShot(poolKey, ticker, recentShots);
    return {
      ...shot,
      file: `${i + 1}-${shot.product.toLowerCase().replace(/\s+/g, "-")}.png`,
      fallbackId: poolKey.startsWith("meridian_event") ? "meridian.megacap_week" : undefined,
      fallbackParams: poolKey.startsWith("meridian_event") ? { panel: "megacap_week" } : undefined,
    };
  });

  const slug = `creative-${comboIndex >= 0 ? comboIndex : 0}-${ticker.toLowerCase()}-${Date.now().toString(36)}`;
  const label = shots.map((s) => s.label).join(" · ");

  state.recent_combos = [comboKeys.join("+"), ...recentCombos.filter((c) => c !== comboKeys.join("+"))].slice(0, 12);
  state.recent_shots = [...shots.map((s) => s.id), ...recentShots.filter((id) => !shots.some((s) => s.id === id))].slice(0, 48);
  saveCreativeState(state);

  return {
    slug,
    label,
    ticker: ticker.toUpperCase(),
    combo: comboKeys,
    shots,
    creative: true,
  };
}

export function nextCopyOpener() {
  const state = loadCreativeState();
  const recent = state.recent_openers ?? [];
  const opener = lruPick(COPY_OPENERS, recent, (o) => o);
  state.recent_openers = [opener, ...recent.filter((o) => o !== opener)].slice(0, 10);
  saveCreativeState(state);
  return opener;
}

export function fmtPrem(n) {
  const v = Math.abs(Number(n));
  if (!Number.isFinite(v) || v === 0) return null;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e3) return `$${Math.round(v / 1e3)}K`;
  return `$${Math.round(v)}`;
}

export function fmtGex(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return null;
  const abs = Math.abs(v);
  const sign = v < 0 ? "−" : "+";
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(0)}M`;
  return `${sign}$${Math.round(abs / 1e3)}K`;
}

/**
 * Scan watchlist tickers — rank by tape premium + gamma magnitude for the hero name.
 */
export async function pickHotTicker(fetchJson, base) {
  const rows = await Promise.all(
    TICKERS.map(async (ticker) => {
      const [posR, flowR] = await Promise.all([
        fetchJson(base, `/api/market/gex-positioning?ticker=${ticker}`),
        fetchJson(base, `/api/market/flows?limit=15&ticker=${ticker}`),
      ]);
      const pos = posR.ok ? posR.json : {};
      const flows = (flowR.ok ? flowR.json?.flows : []) ?? [];
      flows.sort((a, b) => (Number(b.premium) || 0) - (Number(a.premium) || 0));
      const top = flows[0] ?? {};
      const premium = Number(top.premium) || 0;
      const netGex = Number(pos.net_gex ?? pos.netGex) || 0;
      const score = premium / 1e6 + Math.abs(netGex) / 1e9 + (ticker === "SPX" ? 0.5 : 0);
      return {
        ticker,
        spot: pos.spot,
        netGex,
        callWall: pos.call_wall ?? pos.callWall,
        putWall: pos.put_wall ?? pos.putWall,
        flip: pos.flip ?? pos.gamma_flip,
        top,
        premium,
        score,
      };
    }),
  );
  rows.sort((a, b) => b.score - a.score);
  return rows;
}

/**
 * Build copy from live story + the specific panels captured.
 */
export function buildCreativeCopy(story, pack) {
  const opener = nextCopyOpener();
  const t = story.ticker ?? pack.ticker ?? "NVDA";
  const sym = t === "SPX" ? "$SPX" : `$${t}`;
  const spot = story.spot != null ? Number(story.spot).toFixed(t === "SPX" ? 2 : 2) : "—";
  const gexStr = fmtGex(story.netGex);
  const neg = Number(story.netGex) < 0;
  const top = story.top ?? {};
  const prem = fmtPrem(top.premium);
  const typ = String(top.option_type ?? "CALL").toUpperCase();
  const strike = top.strike;

  const panelLine = pack.shots.map((s, i) => `${["①", "②", "③", "④"][i]} ${s.label}`).join("  ");

  const dataHook =
    prem && strike
      ? `${sym} ${spot} · ${prem} ${typ} ${strike}${neg ? ` · short γ (${gexStr})` : gexStr ? ` · ${gexStr} net GEX` : ""}`
      : `${sym} ${spot}${gexStr ? ` · ${neg ? "short" : "long"} gamma (${gexStr})` : ""}`;

  const wallBit =
    story.callWall && story.putWall ? `Walls ${story.putWall}/${story.callWall}.` : "";

  return [opener, "", dataHook, wallBit, panelLine, "", "Four desks · live numbers ↓"].filter(Boolean).join("\n");
}
