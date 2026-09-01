/**
 * Shared X post assembly — BLACK50 promo + Whop link on EVERY manual audit post.
 * Panel packs rotate so consecutive posts don't repeat the same four screenshots.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const PROMO_CODE = "BLACK50";
export const PROMO_LINE = "Use BLACK50 for 50% off your first month.";
export const WHOP_BASE = "https://whop.com/joined/blackout-2d9c/";
export const POST_CHAR_LIMIT = 280;
export const T_CO_LENGTH = 23;

const ROTATION_PATH = join(process.cwd(), "data/x-intel/post-rotation.json");

/** Whop hook lines — rotated so the foot reads different even when promo is fixed. */
export const WHOP_HOOKS = [
  "Join the desk →",
  "Full stack live →",
  "Try the desk →",
  "Start here →",
  "Get access →",
  "See it live →",
];

/** X counts every URL as 23 chars (t.co). */
export function xWeightedLength(text) {
  const urls = text.match(/https?:\/\/\S+/g) ?? [];
  const raw = urls.reduce((n, u) => n + u.length, 0);
  return text.length - raw + urls.length * T_CO_LENGTH;
}

export function taggedWhopUrl(slug, variant = "promo") {
  const u = new URL(WHOP_BASE);
  u.searchParams.set("utm_source", "x");
  u.searchParams.set("utm_medium", "social");
  u.searchParams.set("utm_campaign", "x-audit");
  u.searchParams.set("utm_content", `${slug}:${variant}`);
  return u.toString();
}

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

function loadRotation() {
  if (!existsSync(ROTATION_PATH)) {
    return { recent_packs: [], recent_hooks: [] };
  }
  try {
    return JSON.parse(readFileSync(ROTATION_PATH, "utf8"));
  } catch {
    return { recent_packs: [], recent_hooks: [] };
  }
}

function saveRotation(state) {
  mkdirSync(dirname(ROTATION_PATH), { recursive: true });
  writeFileSync(ROTATION_PATH, JSON.stringify(state, null, 2));
}

export function nextWhopHook() {
  const state = loadRotation();
  const recent = state.recent_hooks ?? [];
  const hook = lruPick(WHOP_HOOKS, recent, (h) => h);
  state.recent_hooks = [hook, ...recent.filter((h) => h !== hook)].slice(0, 12);
  saveRotation(state);
  return hook;
}

/**
 * Four-shot panel packs — deliberately NOT matrix+whale tape every time.
 * Each pack has a slug, human label, shots[], and optional buildCopy(story).
 */
export const PANEL_PACKS = [
  {
    slug: "semis-analytics-megacap",
    label: "Semis sector grid · Helix analytics · Meridian megacap week · Largo board",
    ticker: "NVDA",
    shots: [
      { product: "Thermal", id: "thermal.sector_grid.semis", file: "1-thermal-semis.png" },
      { product: "Helix", id: "helix.analytics_panels", file: "2-helix-analytics.png" },
      { product: "Meridian", id: "meridian.megacap_week", file: "3-meridian-megacap.png", params: { panel: "megacap_week" } },
      { product: "Largo", id: "largo.board_best", file: "4-largo-board.png" },
    ],
    buildCopy: () =>
      [
        "Not matrix + tape again.",
        "",
        "① Semis sector grid  ② Helix analytics overlay",
        "③ Meridian mega-cap earnings week  ④ Largo — strongest setup on the board",
        "",
        "Four different panel types · one post ↓",
      ].join("\n"),
  },
  {
    slug: "ai-net-premium-next24h",
    label: "AI sector grid · Helix net premium · Meridian next 24h · Largo gamma",
    ticker: "NVDA",
    shots: [
      { product: "Thermal", id: "thermal.sector_grid.ai", file: "1-thermal-ai.png" },
      { product: "Helix", id: "helix.net_premium", file: "2-helix-net-premium.png" },
      { product: "Meridian", id: "meridian.next_24h", file: "3-meridian-24h.png", params: { panel: "next_24h" } },
      {
        product: "Largo",
        id: "largo.gamma_read",
        file: "4-largo-gamma.png",
        params: { ticker: "NVDA", question: "What's the gamma positioning read on NVDA right now?" },
      },
    ],
    buildCopy: (s) =>
      [
        `$NVDA ${s?.spot != null ? Number(s.spot).toFixed(2) : "—"} · AI names on one Thermal grid`,
        "",
        "Helix net-premium rail · Meridian next-24h clock · Largo gamma reconcile",
        "",
        "Breadth + timing + dealer read ↓",
      ].join("\n"),
  },
  {
    slug: "mag7-surprise-top-prints",
    label: "Mag7 grid · Helix top prints · Meridian surprise map · Largo flow why",
    ticker: "META",
    shots: [
      { product: "Thermal", id: "thermal.sector_grid.mega", file: "1-thermal-mag7.png" },
      { product: "Helix", id: "helix.top_prints", file: "2-helix-top-prints.png" },
      { product: "Meridian", id: "meridian.surprise_scatter", file: "3-meridian-surprise.png", params: { panel: "surprise_scatter" } },
      {
        product: "Largo",
        id: "largo.flow_why",
        file: "4-largo-flow.png",
        params: { ticker: "META", question: "Why is META seeing this flow — who's paying up?" },
      },
    ],
    buildCopy: (s) =>
      [
        `$META ${s?.spot != null ? Number(s.spot).toFixed(2) : "—"} · Mag7 compare grid`,
        "",
        "Top prints overlay · earnings surprise scatter · Largo ties flow to positioning",
        "",
        "Mega-cap week, four lenses ↓",
      ].join("\n"),
  },
  {
    slug: "indices-calendar-spx-shift",
    label: "Indices grid · SPX whales · Meridian calendar heat · Largo SPX shift",
    ticker: "SPX",
    shots: [
      { product: "Thermal", id: "thermal.sector_grid.indices", file: "1-thermal-indices.png" },
      { product: "Helix", id: "helix.tape.spx.whales", file: "2-helix-spx-whales.png" },
      { product: "Meridian", id: "meridian.calendar_heat", file: "3-meridian-calendar.png", params: { panel: "calendar_heat" } },
      {
        product: "Largo",
        id: "largo.spx_shift",
        file: "4-largo-spx.png",
        params: { ticker: "SPX", question: "What would shift SPX dealer positioning today?" },
      },
    ],
    buildCopy: (s) => {
      const neg = Number(s?.netGex ?? s?.net_gex) < 0;
      return [
        `$SPX ${s?.spot != null ? Number(s.spot).toFixed(2) : "—"} · ${neg ? "short" : "long"} gamma`,
        "",
        "Indices Thermal grid · index whale tape · print calendar · Largo shift read",
        "",
        "Index stack, four panels ↓",
      ].join("\n");
    },
  },
  {
    slug: "space-tsla-vex-revisions",
    label: "Space grid · TSLA 0DTE+VEX · Meridian revisions · Largo flow",
    ticker: "TSLA",
    shots: [
      { product: "Thermal", id: "thermal.sector_grid.space", file: "1-thermal-space.png" },
      { product: "Helix", id: "helix.tape.tsla.0dte", file: "2-helix-tsla-0dte.png" },
      { product: "Thermal", id: "thermal.matrix.tsla.vex", file: "3-thermal-tsla-vex.png" },
      { product: "Meridian", id: "meridian.revision_timeline", file: "4-meridian-revisions.png", params: { panel: "revision_timeline" } },
    ],
    buildCopy: (s) =>
      [
        `$TSLA ${s?.spot != null ? Number(s.spot).toFixed(2) : "—"} · 0DTE tape + VEX lens`,
        "",
        "Space names grid · vol-exposure matrix · Meridian estimate revisions",
        "",
        "Momentum name, three products ↓",
      ].join("\n"),
  },
  {
    slug: "crypto-financials-strikes",
    label: "Crypto grid · Helix top strikes · Meridian high impact · Largo gamma",
    ticker: "COIN",
    shots: [
      { product: "Thermal", id: "thermal.sector_grid.crypto", file: "1-thermal-crypto.png" },
      { product: "Helix", id: "helix.top_strikes", file: "2-helix-top-strikes.png" },
      { product: "Meridian", id: "meridian.high_impact_grid", file: "3-meridian-high-impact.png", params: { panel: "high_impact" } },
      {
        product: "Largo",
        id: "largo.gamma_read",
        file: "4-largo-gamma.png",
        params: { ticker: "COIN", question: "What's the gamma read on COIN after this tape?" },
      },
    ],
    buildCopy: () =>
      [
        "Crypto + rates cross-current.",
        "",
        "① Crypto sector grid  ② Helix top-strike ladder",
        "③ Meridian high-impact grid  ④ Largo gamma positioning",
        "",
        "Risk-on slice, four desks ↓",
      ].join("\n"),
  },
  {
    slug: "healthcare-energy-analytics-rail",
    label: "Healthcare grid · Helix analytics rail · Meridian earnings pulse · Largo flow",
    ticker: "LLY",
    shots: [
      { product: "Thermal", id: "thermal.sector_grid.healthcare", file: "1-thermal-healthcare.png" },
      { product: "Helix", id: "helix.analytics_rail.market", file: "2-helix-analytics-rail.png" },
      { product: "Meridian", id: "meridian.next_24h", file: "3-meridian-earnings-pulse.png", params: { panel: "next_24h" } },
      {
        product: "Largo",
        id: "largo.flow_why",
        file: "4-largo-flow.png",
        params: { ticker: "LLY", question: "Why is LLY flow clustering here — catalyst or positioning?" },
      },
    ],
    buildCopy: () =>
      [
        "Healthcare sector compare — not a single-name matrix.",
        "",
        "Analytics rail breadth · Meridian earnings clock · Largo flow why",
        "",
        "Sector story, four attachments ↓",
      ].join("\n"),
  },
  {
    slug: "quad-desk-ticker",
    label: "Per-ticker quad — Meridian · Helix whales · Thermal GEX · Largo reconcile",
    ticker: "NVDA",
    dynamicTicker: true,
    shots: (ticker) => [
      { product: "Meridian", id: `meridian.event.${ticker.toLowerCase()}.report`, file: "1-meridian.png", fallbackId: "meridian.megacap_week", params: { panel: "megacap_week" } },
      { product: "Helix", id: `helix.tape.${ticker.toLowerCase()}.whales`, file: "2-helix.png" },
      { product: "Thermal", id: `thermal.matrix.${ticker.toLowerCase()}.gex`, file: "3-thermal.png" },
      {
        product: "Largo",
        id: "largo.flow_why",
        file: "4-largo.png",
        params: { ticker, question: `Why is ${ticker} seeing this flow — reconcile tape vs gamma walls.` },
      },
    ],
    buildCopy: (s) => {
      const t = s?.ticker ?? "NVDA";
      return [
        `$${t} ${s?.spot != null ? Number(s.spot).toFixed(2) : "—"} · four desks, one ticker`,
        "",
        "Meridian catalyst · Helix whales · Thermal walls · Largo reconcile",
        "",
        "Full stack on one name ↓",
      ].join("\n");
    },
  },
];

export function getPanelPack(slug) {
  const hit = PANEL_PACKS.find((p) => p.slug === slug);
  if (!hit) throw new Error(`Unknown panel pack: ${slug}. Known: ${PANEL_PACKS.map((p) => p.slug).join(", ")}`);
  return hit;
}

/** Pick the next panel pack (least recently used). */
export function nextPanelPack() {
  const state = loadRotation();
  const recent = state.recent_packs ?? [];
  const pack = lruPick(PANEL_PACKS, recent, (p) => p.slug);
  state.recent_packs = [pack.slug, ...recent.filter((s) => s !== pack.slug)].slice(0, 16);
  saveRotation(state);
  return pack;
}

/**
 * Append BLACK50 + Whop to body; trim body lines until the whole post fits 280 (X-weighted).
 */
export function assemblePost(body, slug, opts = {}) {
  const hook = opts.whopHook ?? nextWhopHook();
  const whopUrl = taggedWhopUrl(slug, opts.variant ?? "promo");
  const footers = [
    `\n\n${PROMO_LINE}\n${hook} ${whopUrl}`,
    `\n\n${PROMO_LINE} ${hook} ${whopUrl}`,
    `\n${PROMO_LINE} ${hook} ${whopUrl}`,
  ];

  let lines = String(body)
    .trim()
    .split("\n")
    .filter((l, i, arr) => l.length > 0 || (i > 0 && i < arr.length - 1));

  for (const footer of footers) {
    let attempt = `${lines.join("\n")}${footer}`;
    if (xWeightedLength(attempt) <= POST_CHAR_LIMIT) return attempt;

    while (lines.length > 2 && xWeightedLength(`${lines.join("\n")}${footer}`) > POST_CHAR_LIMIT) {
      const mid = Math.floor(lines.length / 2);
      lines = [...lines.slice(0, mid), ...lines.slice(mid + 1)];
    }
    attempt = `${lines.join("\n")}${footer}`;
    if (xWeightedLength(attempt) <= POST_CHAR_LIMIT) return attempt;
  }

  return `${PROMO_LINE} ${hook} ${whopUrl}`.slice(0, POST_CHAR_LIMIT);
}

export function resolvePackShots(pack, tickerOverride) {
  const ticker = (tickerOverride ?? pack.ticker ?? "NVDA").toUpperCase();
  if (typeof pack.shots === "function") return pack.shots(ticker);
  return pack.shots.map((s) => ({
    ...s,
    params: s.params?.ticker != null ? { ...s.params, ticker: tickerOverride ?? s.params.ticker } : s.params,
  }));
}
