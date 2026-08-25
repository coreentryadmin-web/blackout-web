/**
 * Live story signals for smart X posts — king nodes (Vector) + banger catches (Night Hawk).
 * Every number comes from prod APIs; nothing fabricated.
 */
import { fmtGex, fmtPrem } from "./x-social-creative.mjs";

const WATCH = ["NVDA", "TSLA", "META", "AAPL", "AMZN", "SPY", "QQQ", "SPX", "COIN", "LLY", "IWM"];

function pick(obj, ...keys) {
  for (const k of keys) {
    if (obj?.[k] != null) return obj[k];
  }
  return null;
}

export async function loadKingNodeStory(fetchJson, base, ticker, horizon = "weekly") {
  const sym = ticker.toUpperCase();
  const [posR, heatR, wallsR] = await Promise.all([
    fetchJson(base, `/api/market/gex-positioning?ticker=${sym}`),
    fetchJson(base, `/api/market/gex-heatmap?ticker=${sym}`),
    fetchJson(base, `/api/market/vector/walls?ticker=${sym}&dte=${horizon}`),
  ]);
  const pos = posR.ok ? posR.json : {};
  const heat = heatR.ok ? heatR.json : {};
  const walls = wallsR.ok ? wallsR.json : {};
  const strikeTotals = heat?.gex?.strike_totals ?? {};
  const kingStrike =
    pick(pos, "gex_king_strike", "king_strike") ??
    pick(heat?.gex, "call_wall") ??
    walls?.walls?.callWalls?.[0]?.strike;
  const kingRaw = kingStrike != null ? strikeTotals[String(kingStrike)] : null;
  const kingGamma =
    pick(pos, "gex_king_gamma", "king_gamma") ??
    (kingRaw != null && Number.isFinite(Number(kingRaw)) ? Math.abs(Number(kingRaw)) : null);
  const spot = pick(pos, "spot") ?? pick(heat, "spot");
  const topCall = walls?.walls?.callWalls?.[0];
  const topPut = walls?.walls?.putWalls?.[0];
  const distPct =
    spot != null && kingStrike != null ? ((Number(kingStrike) - Number(spot)) / Number(spot)) * 100 : null;

  return {
    type: "king",
    ticker: sym,
    horizon,
    spot,
    kingStrike: kingStrike != null ? Number(kingStrike) : null,
    kingGamma,
    kingSide: topCall?.strike === kingStrike ? "call" : topPut?.strike === kingStrike ? "put" : "gamma",
    distPct,
    flip: pick(pos, "flip", "gamma_flip") ?? walls?.flip,
    callWall: pick(pos, "call_wall", "callWall") ?? topCall?.strike,
    putWall: pick(pos, "put_wall", "putWall") ?? topPut?.strike,
    netGex: pick(pos, "net_gex", "netGex") ?? heat?.gex?.total,
    topCallPct: topCall?.pct,
    score: (kingGamma ?? 0) / 1e6 + Math.abs(distPct ?? 0) * 0.05,
  };
}

export async function loadBangerStory(fetchJson, base) {
  const r = await fetchJson(base, "/api/market/banger/board");
  if (!r.ok || !r.json?.available) return { type: "banger", ok: false, score: 0, rows: [] };
  const open = r.json.open ?? [];
  const closed = r.json.closed ?? [];
  const rows = [...open, ...closed].map((p) => ({
    ticker: p.ticker,
    status: p.status,
    entry: p.entry_premium,
    mark: p.last_mark,
    peak: p.peak_premium,
    pnlPct: p.realized_pnl_pct,
    gain: p.discovery?.gain,
    strike: p.contract?.strike,
    expiry: p.contract?.expiry,
    score:
      (Number(p.peak_premium) || 0) / 1e6 +
      Math.abs(Number(p.realized_pnl_pct) || 0) / 100 +
      (Number(p.discovery?.gain) || 0) / 100,
  }));
  rows.sort((a, b) => b.score - a.score);
  return { type: "banger", ok: rows.length > 0, score: rows[0]?.score ?? 0, rows, top: rows[0] ?? null };
}

export async function scanStoryCandidates(fetchJson, base) {
  const [banger, ...kings] = await Promise.all([
    loadBangerStory(fetchJson, base),
    ...WATCH.map((t) => loadKingNodeStory(fetchJson, base, t, "weekly")),
  ]);
  const monthlyKings = await Promise.all(
    ["NVDA", "TSLA", "META", "AAPL"].map((t) => loadKingNodeStory(fetchJson, base, t, "monthly")),
  );

  const candidates = [];
  if (banger.ok && banger.top) {
    candidates.push({ ...banger, kind: "banger-board", ticker: banger.top.ticker });
  }
  for (const k of kings) {
    if (k.kingStrike != null && k.kingGamma != null) {
      candidates.push({ ...k, kind: "king-weekly" });
    }
  }
  for (const k of monthlyKings) {
    if (k.kingStrike != null && k.kingGamma != null) {
      candidates.push({ ...k, kind: "king-monthly", horizon: "monthly" });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  return candidates;
}

/** Four-shot pack: king node lit on Vector + flow + gamma + reconcile. */
export function composeKingNodePack(story) {
  const t = story.ticker;
  const tl = t.toLowerCase();
  const horizon = story.horizon ?? "weekly";
  const horizonLabel = horizon === "monthly" ? "monthly (~7–35DTE)" : "weekly (≤7DTE)";
  return {
    slug: `king-node-${horizon}-${tl}`,
    label: `Vector ${horizon} king node · Helix flow · Thermal GEX · Largo read`,
    ticker: t,
    story,
    creative: true,
    storyKind: "king",
    shots: [
      {
        product: "Vector",
        id: `vector.desk.${tl}.${horizon}.15m`,
        label: `${t} ${horizon} king node + beads`,
        file: "1-vector-king.png",
        params: { ticker: t, horizon, timeframe: "15", wait_beads: true, session_viewport: true },
      },
      {
        product: "Helix",
        id: `helix.tape.${tl}.whales`,
        label: `${t} whale tape into the node`,
        file: "2-helix-flow.png",
      },
      {
        product: "Thermal",
        id: `thermal.matrix.${tl}.gex`,
        label: `${t} GEX matrix at king strike`,
        file: "3-thermal-gex.png",
      },
      {
        product: "Largo",
        id: t === "SPX" ? "largo.spx_shift" : "largo.gamma_read",
        label: t === "SPX" ? "Largo SPX shift read" : "Largo king-node read",
        file: "4-largo-read.png",
        params:
          t === "SPX"
            ? {
                ticker: "SPX",
                question: "What changed in SPX in the last 15 minutes — gamma, flow, and levels?",
              }
            : {
                ticker: t,
                question: `The Vector king anchor is at ${story.kingStrike} on ${t} — what's the gamma setup and where does price go if that node breaks?`,
              },
      },
    ],
    buildCopy: (s) => buildKingNodeCopy({ ...story, ...s }),
    meta: { horizonLabel },
  };
}

/** Banger caught early — scan → board → Vector structure → tape. */
export function composeBangerPack(story, bangerRow) {
  const t = (bangerRow?.ticker ?? story?.ticker ?? "NVDA").toUpperCase();
  const tl = t.toLowerCase();
  return {
    slug: `banger-caught-${tl}`,
    label: "Night Hawk banger board · Vector weekly · Helix tape · Thermal",
    ticker: t,
    story: { ...story, banger: bangerRow },
    creative: true,
    storyKind: "banger",
    shots: [
      { product: "Night Hawk", id: "nighthawk.deck.banger", label: "Banger lane board", file: "1-nighthawk-banger.png" },
      {
        product: "Vector",
        id: `vector.desk.${tl}.weekly.15m`,
        label: `${t} weekly king + bead trail`,
        file: "2-vector-king.png",
        params: { ticker: t, horizon: "weekly", timeframe: "15", wait_beads: true, session_viewport: true },
      },
      { product: "Helix", id: `helix.tape.${tl}.1m`, label: `${t} $1M+ tape`, file: "3-helix-tape.png" },
      { product: "Thermal", id: `thermal.matrix.${tl}.vex`, label: `${t} VEX into the move`, file: "4-thermal-vex.png" },
    ],
    buildCopy: (s) => buildBangerCopy(bangerRow, s),
  };
}

const KING_OPENERS = [
  "The node was lit before the move hit the timeline.",
  "This is what catching it early looks like on the desk.",
  "Dealers telegraph through gamma walls — we map them as they form.",
  "Not a screenshot after the fact. The king anchor was already on the chart.",
  "Wall formed → bead row lit → price followed. That order matters.",
];

const BANGER_OPENERS = [
  "Whole-market scan flagged this before the breakout tape.",
  "Banger engine caught the name on discovery — not after CNBC.",
  "This is the board row when the scan commits a name early.",
  "Breakout screen → board → scale-out rule. The full arc.",
];

function nextOpener(pool, stateKey, state) {
  const recent = state[stateKey] ?? [];
  const pick = pool.find((o) => !recent.includes(o)) ?? pool[0];
  state[stateKey] = [pick, ...recent.filter((x) => x !== pick)].slice(0, 8);
  return pick;
}

let openerState = {};

export function buildKingNodeCopy(story) {
  const opener = nextOpener(KING_OPENERS, "king", openerState);
  const sym = story.ticker === "SPX" ? "$SPX" : `$${story.ticker}`;
  const spot = story.spot != null ? Number(story.spot).toFixed(2) : "—";
  const king = story.kingStrike != null ? Math.round(story.kingStrike) : "—";
  const kingAmt = story.kingGamma != null ? fmtPrem(story.kingGamma) : null;
  const horizon = story.horizon === "monthly" ? "monthly book" : "weekly book";
  const dist =
    story.distPct != null
      ? `${story.distPct > 0 ? "+" : ""}${story.distPct.toFixed(1)}% to king`
      : null;

  const hook =
    kingAmt && king !== "—"
      ? `${sym} ${spot} · king node ${king} (${kingAmt} γ) on the ${horizon}`
      : `${sym} ${spot} · king node ${king} on Vector ${horizon}`;

  const panels = "Vector beads + anchor · Helix whales · Thermal walls · Largo read";

  return [opener, "", hook, dist, panels, "", "Four lenses · same strike ↓"].filter(Boolean).join("\n");
}

export function buildBangerCopy(row, story) {
  if (!row) return buildKingNodeCopy(story ?? { ticker: "NVDA" });
  const opener = nextOpener(BANGER_OPENERS, "banger", openerState);
  const sym = `$${row.ticker}`;
  const gain = row.gain != null ? `+${Number(row.gain).toFixed(1)}% discovery` : null;
  const pnl = row.pnlPct != null ? `${row.pnlPct > 0 ? "+" : ""}${Number(row.pnlPct).toFixed(0)}%` : null;
  const prem = fmtPrem(row.peak ?? row.entry);

  const hook = [sym, gain, pnl ? `${pnl} on board` : null, prem ? `${prem} peak` : null].filter(Boolean).join(" · ");

  return [
    opener,
    "",
    hook,
    "Night Hawk banger lane · Vector king trail · Helix $1M tape · VEX lens",
    "",
    "Scan → commit → track. Live ↓",
  ]
    .filter(Boolean)
    .join("\n");
}

export function pickStoryPack(candidates, prefer) {
  if (prefer === "king" || prefer === "king-node") {
    const k = candidates.find((c) => c.kind?.startsWith("king"));
    if (k) return composeKingNodePack(k);
  }
  if (prefer === "banger") {
    const b = candidates.find((c) => c.kind === "banger-board");
    if (b?.top) return composeBangerPack(b, b.top);
  }
  const top = candidates[0];
  if (!top) return null;
  if (top.kind === "banger-board" && top.top && top.score > 2) {
    return composeBangerPack(top, top.top);
  }
  if (top.kind?.startsWith("king") && top.kingGamma > 0) {
    return composeKingNodePack(top);
  }
  return null;
}
