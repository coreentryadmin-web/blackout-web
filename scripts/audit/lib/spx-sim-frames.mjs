/*
 * PURE synthetic-frame builders for the SPX Slayer desk simulator (fix/spx-desk-sim).
 *
 * No network, no secrets, no side effects — every function is a pure map from an ET minute to
 * a plain-object payload, so the whole arc can be unit-tested (spx-sim-frames.test.ts) and the
 * feeder (scripts/audit/spx-sim-feed.mjs) just POSTs what these return. Payloads are focused on
 * the load-bearing display fields each desk panel reads; the desk renders the rest defensively.
 *
 * The arc: spot marches up through the gamma flip (a gamma-flip cross), GEX walls build, the pin
 * drifts and tightens into the close, and one directional play runs its full lifecycle
 * (SCANNING → WATCHING → armed BUY → OPEN/managed → CLOSED).
 */

const SESSION_DATE = new Date().toISOString().slice(0, 10);
export const RTH_OPEN_ET = 570; // 09:30
export const RTH_LAST_ET = 955; // 15:55
export const GAMMA_FLIP = 6310;
export const CALL_WALL = 6350;
export const PUT_WALL = 6250;
export const GEX_KING = 6350;
export const MAX_PAIN = 6325;

function interp(keyframes, m) {
  if (m <= keyframes[0][0]) return keyframes[0][1];
  for (let i = 1; i < keyframes.length; i++) {
    if (m <= keyframes[i][0]) {
      const [m0, v0] = keyframes[i - 1];
      const [m1, v1] = keyframes[i];
      const t = m1 === m0 ? 0 : (m - m0) / (m1 - m0);
      return v0 + (v1 - v0) * t;
    }
  }
  return keyframes[keyframes.length - 1][1];
}
const r2 = (x) => Math.round(x * 100) / 100;

export function fmtEt(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
const etIso = (m) => `${SESSION_DATE}T${fmtEt(m)}:00-04:00`;

// ── spot / vix arcs ──────────────────────────────────────────────────────────────────
const SPOT_KF = [
  [570, 6300], [600, 6318], [660, 6335], [720, 6340], [810, 6332], [900, 6326], [955, 6325],
];
const VIX_KF = [[570, 14.2], [720, 13.4], [955, 13.0]];
export function spotAt(m) { return r2(interp(SPOT_KF, m)); }
export function vixAt(m) { return r2(interp(VIX_KF, m)); }
const PRIOR_CLOSE = 6296;

/** Coarse session buckets so the header/clock chips render. */
function marketBlock(m) {
  const open = m >= RTH_OPEN_ET && m <= 960;
  return {
    market_open: open,
    market_status: open ? "open" : "closed",
    market_label: open ? "RTH OPEN" : "CLOSED",
  };
}

// ── GEX matrix ─────────────────────────────────────────────────────────────────────
const MATRIX_STRIKES = (() => {
  const out = [];
  for (let s = 6400; s >= 6250; s -= 5) out.push(s);
  return out; // descending, like the live matrix axis
})();
const MATRIX_EXPIRIES = [SESSION_DATE, isoPlusDays(1), isoPlusDays(2), isoPlusDays(7), isoPlusDays(30)];
function isoPlusDays(n) {
  const d = new Date(`${SESSION_DATE}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * Net dealer dollar-gamma at a strike for one expiry. Positive above the flip (peaking at the
 * call wall), negative below (troughing at the put wall). Near-dated expiries carry the most
 * gamma; far-dated columns are scaled down. Pure function of (strike, expiryIndex).
 */
function cellGamma(strike, expiryIndex) {
  const nearScale = [1, 0.7, 0.5, 0.28, 0.55][expiryIndex] ?? 0.2; // monthly OpEx re-thickens
  const wall = strike >= GAMMA_FLIP ? CALL_WALL : PUT_WALL;
  const dist = Math.abs(strike - wall);
  const peak = strike >= GAMMA_FLIP ? 9.0e8 : -8.2e8;
  // Gaussian-ish hump centered on the wall.
  const mag = peak * Math.exp(-((dist / 45) ** 2));
  return Math.round(mag * nearScale);
}

export function buildGexHeatmapFrame(m) {
  const spot = spotAt(m);
  const cells = {};
  const strike_totals = {};
  for (const strike of MATRIX_STRIKES) {
    const row = {};
    let total = 0;
    MATRIX_EXPIRIES.forEach((exp, i) => {
      const v = cellGamma(strike, i);
      row[exp] = v;
      total += v;
    });
    cells[String(strike)] = row;
    strike_totals[String(strike)] = total;
  }
  const total = Object.values(strike_totals).reduce((a, b) => a + b, 0);
  const gexBlock = {
    cells,
    strike_totals,
    call_wall: CALL_WALL,
    put_wall: PUT_WALL,
    total,
    flip: GAMMA_FLIP,
    regime: spot >= GAMMA_FLIP ? "long_gamma" : "short_gamma",
  };
  // A thin VEX block so the VEX lens toggle is live too.
  const vexCells = {};
  const vexTotals = {};
  for (const strike of MATRIX_STRIKES) {
    const row = {};
    let t = 0;
    MATRIX_EXPIRIES.forEach((exp, i) => {
      const v = Math.round(cellGamma(strike, i) * 0.12);
      row[exp] = v;
      t += v;
    });
    vexCells[String(strike)] = row;
    vexTotals[String(strike)] = t;
  }
  return {
    available: true,
    underlying: "SPX",
    spot,
    change_pct: r2(((spot - PRIOR_CLOSE) / PRIOR_CLOSE) * 100),
    asof: new Date().toISOString(),
    expiries: MATRIX_EXPIRIES,
    near_term_expiries: MATRIX_EXPIRIES.slice(0, 3),
    strikes: MATRIX_STRIKES,
    max_pain: MAX_PAIN,
    gex: gexBlock,
    vex: {
      cells: vexCells,
      strike_totals: vexTotals,
      call_wall: CALL_WALL,
      put_wall: PUT_WALL,
      total: Object.values(vexTotals).reduce((a, b) => a + b, 0),
      flip: GAMMA_FLIP,
    },
    shift: { available: false, status: "collecting" },
    vex_shift: { available: false, status: "collecting" },
  };
}

const GEX_WALLS = [
  { strike: CALL_WALL, kind: "call_wall", net_gamma: 9.0e8 },
  { strike: PUT_WALL, kind: "put_wall", net_gamma: -8.2e8 },
  { strike: GAMMA_FLIP, kind: "flip", net_gamma: 0 },
];

// ── desk / pulse / flow ──────────────────────────────────────────────────────────────
export function buildDeskFrame(m) {
  const spot = spotAt(m);
  const vix = vixAt(m);
  const vwap = r2(interp([[570, 6300], [720, 6330], [955, 6328]], m));
  return {
    available: true,
    as_of: new Date().toISOString(),
    polled_at: new Date().toISOString(),
    source: "sim",
    price: spot,
    spx_change_pct: r2(((spot - PRIOR_CLOSE) / PRIOR_CLOSE) * 100),
    vix,
    vix_change_pct: r2(((vix - 14.4) / 14.4) * 100),
    above_vwap: spot >= vwap,
    lod: 6298,
    hod: r2(Math.max(spot, 6340)),
    vwap,
    vwap_volume_weighted: true,
    pdh: 6305,
    pdl: 6270,
    prior_close: PRIOR_CLOSE,
    gap_pct: r2(((6300 - PRIOR_CLOSE) / PRIOR_CLOSE) * 100),
    gap_source: "SPX",
    ema20: r2(spot - 3),
    ema50: r2(spot - 8),
    ema200: r2(spot - 22),
    sma50: r2(spot - 10),
    sma200: r2(spot - 40),
    tick: 420,
    trin: 0.82,
    add: 1150,
    internals_estimated: { tick: false, trin: false, add: false },
    gex_net: 3.1e9,
    gex_king: GEX_KING,
    max_pain: MAX_PAIN,
    gamma_flip: GAMMA_FLIP,
    above_gamma_flip: spot >= GAMMA_FLIP,
    gamma_regime: spot >= GAMMA_FLIP ? "long_gamma" : "short_gamma",
    gex_walls: GEX_WALLS,
    flow_0dte_call_premium: 4.2e7,
    flow_0dte_put_premium: 2.8e7,
    flow_0dte_net: 1.4e7,
    tide_bias: spot >= GAMMA_FLIP ? "bullish" : "bearish",
    tide_call_premium: 5.1e7,
    tide_put_premium: 3.3e7,
    tide_net: 1.8e7,
    nope: 12.4,
    nope_net_delta: 3.2e6,
    uw_iv_rank: 28,
    regime: spot >= GAMMA_FLIP ? "long gamma · dealers dampen" : "short gamma · dealers amplify",
    levels: [
      { label: "Call wall", value: CALL_WALL, kind: "resistance", distance_pct: r2(((CALL_WALL - spot) / spot) * 100) },
      { label: "Gamma flip", value: GAMMA_FLIP, kind: "neutral", distance_pct: r2(((GAMMA_FLIP - spot) / spot) * 100) },
      { label: "Put wall", value: PUT_WALL, kind: "support", distance_pct: r2(((PUT_WALL - spot) / spot) * 100) },
    ],
    dark_pool: null,
    spx_flows: [],
    unified_tape: buildTape(m),
    opening_range: { high: 6322, low: 6300, break: spot > 6322 ? "above" : "inside", forming: m < 600 },
    strike_stacks: [],
    net_prem_ticks: [],
    vix_term: { vix9d: r2(vix - 0.5), vix3m: r2(vix + 2.1), structure: "contango", detail: "normal term structure" },
    sector_heat: [],
    leader_stocks: [],
    oi_changes: [],
    iv_term_structure: [],
    macro_events: [],
    news_headlines: [],
    active_halts: [],
    halt_channel_stale: false,
    greek_exposure: null,
    flow_by_expiry: [],
    net_flow_by_expiry: [],
    market_breadth: null,
    mag7_greek_flow: null,
    macro_indicators: [],
    gex_stale: false,
    ...marketBlock(m),
  };
}

function buildTape(m) {
  // A couple of large sweeps so the Pulse rail / matrix tape strip lights up.
  if (m < 600) return [];
  return [
    { ticker: "SPXW", side: "CALL", strike: CALL_WALL, premium: 2.4e6, sentiment: "bullish", executed_at: etIso(m), aggressive: true },
    { ticker: "SPXW", side: "PUT", strike: PUT_WALL, premium: 1.6e6, sentiment: "bearish", executed_at: etIso(Math.max(600, m - 2)), aggressive: true },
  ];
}

export function buildPulseFrame(m) {
  const d = buildDeskFrame(m);
  return {
    available: true,
    polled_at: new Date().toISOString(),
    price: d.price,
    spx_change_pct: d.spx_change_pct,
    vix: d.vix,
    vix_change_pct: d.vix_change_pct,
    above_vwap: d.above_vwap,
    lod: d.lod,
    hod: d.hod,
    vwap: d.vwap,
    pdh: d.pdh,
    pdl: d.pdl,
    prior_close: d.prior_close,
    gap_pct: d.gap_pct,
    gap_source: d.gap_source,
    ema20: d.ema20,
    ema50: d.ema50,
    ema200: d.ema200,
    sma50: d.sma50,
    sma200: d.sma200,
    tick: d.tick,
    trin: d.trin,
    add: d.add,
    internals_estimated: d.internals_estimated,
    regime: d.regime,
    leader_stocks: [],
    vix_term: d.vix_term,
    tide_bias: d.tide_bias,
    tide_call_premium: d.tide_call_premium,
    tide_put_premium: d.tide_put_premium,
    active_halts: [],
    halt_channel_stale: false,
    ...marketBlock(m),
  };
}

export function buildFlowFrame(m) {
  const d = buildDeskFrame(m);
  return {
    available: true,
    polled_at: new Date().toISOString(),
    price: d.price,
    dark_pool: null,
    spx_flows: [],
    unified_tape: d.unified_tape,
    gex_walls: GEX_WALLS,
    gex_net: d.gex_net,
    gex_king: GEX_KING,
    gamma_flip: GAMMA_FLIP,
    above_gamma_flip: d.above_gamma_flip,
    gamma_regime: d.gamma_regime,
    flow_0dte_call_premium: d.flow_0dte_call_premium,
    flow_0dte_put_premium: d.flow_0dte_put_premium,
    flow_0dte_net: d.flow_0dte_net,
    strike_stacks: [],
    net_prem_ticks: [],
    flow_by_expiry: [],
    net_flow_by_expiry: [],
    greek_exposure: null,
    gex_stale: false,
  };
}

// ── play lifecycle ─────────────────────────────────────────────────────────────────
const PLAY_ENTRY = 6320;
const PLAY_STOP = 6312;
const PLAY_TARGET = 6345;

/** SCANNING → WATCHING → armed BUY → OPEN/managed → CLOSED, keyed to ET minute. */
export function buildPlayFrame(m) {
  const spot = spotAt(m);
  const base = {
    available: true,
    grade: "A",
    score: 78,
    confidence: 0.72,
    factors: [],
    claude: null,
    cortex: null,
    confirmations: null,
    technicals: null,
    mtf: null,
    option_ticket: null,
    watch: null,
    telemetry: null,
    lotto_play: null,
    power_play: null,
    session_phase: "cash",
    signal_committed: false,
    idle_message: null,
  };

  if (m < 600) {
    return { ...base, phase: "SCANNING", action: "SCANNING", direction: null, score: 0, grade: "—",
      headline: "Scanning SPX structure", thesis: "No qualified setup yet — watching the open drive.",
      idle_message: "Scanning for a structural edge…",
      levels: { entry: null, stop: null, target: null, invalidation: "—" },
      gates: { passed: false, blocks: [], warnings: [], entry_mode: "scan", play_idea: null }, open_play: null };
  }
  if (m < 620) {
    return { ...base, phase: "WATCHING", action: "WATCHING", direction: "long",
      headline: "Long setup forming above VWAP", thesis: "Reclaim of the gamma flip with call-wall pull toward 6350.",
      levels: { entry: PLAY_ENTRY, stop: PLAY_STOP, target: PLAY_TARGET, invalidation: "Loss of VWAP" },
      gates: { passed: false, blocks: ["awaiting_trigger"], warnings: [], entry_mode: "watch", play_idea: "Long 6320c" },
      watch: { active: true, promote_ready: m >= 610, reason: "Basing above flip", since: etIso(600) }, open_play: null };
  }
  // Committed BUY + open, then managed. A SELL exit window (14:25–14:40) precedes the close.
  const opened = m >= 620;
  const exiting = m >= 865 && m < 880; // 14:25–14:40 ET — booking the trade
  const closed = m >= 880; // 14:40 ET — resolved, back to scanning
  const mfe = r2(Math.max(0, spot - PLAY_ENTRY));
  const trimDone = m >= 720; // target tagged mid-session
  let action = "HOLD";
  if (m < 625) action = "BUY";
  else if (exiting) action = "SELL";
  else if (trimDone) action = "TRIM";
  else action = "HOLD";

  if (closed) {
    // Closed: play resolves, engine returns to scanning with the closed trade behind it.
    return { ...base, phase: "SCANNING", action: "SCANNING", direction: null,
      headline: "Play closed +25pts — scanning", thesis: "6320c long hit the 6345 target and trimmed to the runner stop.",
      idle_message: "Trade booked. Scanning for the next edge…",
      levels: { entry: null, stop: null, target: null, invalidation: "—" },
      gates: { passed: false, blocks: [], warnings: [], entry_mode: "scan", play_idea: null }, open_play: null };
  }

  return {
    ...base,
    phase: "OPEN",
    action,
    direction: "long",
    signal_committed: opened,
    headline:
      action === "BUY" ? "BUY — long reclaim armed"
      : action === "SELL" ? "SELL — booking the long into the close"
      : action === "TRIM" ? "TRIM — target tagged, runner live"
      : "HOLD — long working",
    thesis: "Reclaimed the gamma flip; dealers long-gamma dampen dips, call-wall magnet at 6350.",
    levels: { entry: PLAY_ENTRY, stop: PLAY_STOP, target: PLAY_TARGET, invalidation: "5m close back below VWAP" },
    gates: { passed: true, blocks: [], warnings: [], entry_mode: "trigger", play_idea: "Long 6320c" },
    open_play: {
      id: 1,
      direction: "long",
      entry_price: PLAY_ENTRY,
      stop: PLAY_STOP,
      target: PLAY_TARGET,
      grade: "A",
      opened_at: etIso(620),
      mfe_pts: mfe,
      trim_done: trimDone,
      option_label: "SPXW 6320C 0DTE",
      option_premium: "8.40",
    },
  };
}

// ── pin forecast ─────────────────────────────────────────────────────────────────────
export function buildPinFrame(m) {
  const spot = spotAt(m);
  const projected = r2(interp([[600, 6332], [720, 6330], [900, 6326], [955, 6325]], m));
  const pin = Math.round(projected / 5) * 5;
  const pinPct = r2(interp([[600, 0.34], [720, 0.55], [900, 0.74], [955, 0.84]], m));
  const timeToClose = Math.max(0, 960 - m);
  return {
    available: true,
    method: "analytic",
    spot,
    priorClose: PRIOR_CLOSE,
    timeToCloseMin: timeToClose,
    pin,
    projectedClose: projected,
    pinPct,
    pinBand: [pin - 8, pin + 8],
    pinPctOfClose: r2(((pin - PRIOR_CLOSE) / PRIOR_CLOSE) * 100),
    regime: spot >= GAMMA_FLIP ? "long_gamma" : "short_gamma",
    flip: GAMMA_FLIP,
    magnet: { strike: MAX_PAIN, kind: "max_pain", direction: "flat", strengthPct: 62 },
    charmState: m < 720 ? "early" : m < 900 ? "moderate" : "accelerating",
    cone: [
      { tMin: 0, p10: spot - 2, p50: spot, p90: spot + 2 },
      { tMin: Math.round(timeToClose / 2), p10: pin - 10, p50: projected, p90: pin + 10 },
      { tMin: timeToClose, p10: pin - 6, p50: pin, p90: pin + 6 },
    ],
    scenarios: [
      { close: pin, p: pinPct, kind: "max_pain" },
      { close: CALL_WALL, p: r2((1 - pinPct) * 0.6), kind: "call_wall" },
      { close: PUT_WALL, p: r2((1 - pinPct) * 0.4), kind: "put_wall" },
    ],
    degraded: false,
    degradeReason: null,
    ivFallback: false,
    drivers: [
      { label: "Long-gamma pin", detail: "Dealers long gamma above the flip dampen intraday range.", weight: 0.6 },
      { label: "Max-pain magnet", detail: `Max pain ${MAX_PAIN} pulls the close.`, weight: 0.4 },
    ],
  };
}

// ── bundle / arc ─────────────────────────────────────────────────────────────────────
export function buildBundleAt(m) {
  const desk = buildDeskFrame(m);
  const flow = buildFlowFrame(m);
  const pulse = buildPulseFrame(m);
  const gexHeatmap = buildGexHeatmapFrame(m);
  return {
    bootstrap: { desk, flow, pulse, merged: desk, gexHeatmap },
    desk,
    pulse,
    flow,
    play: buildPlayFrame(m),
    pin: buildPinFrame(m),
    gexHeatmap,
  };
}

/** The synthetic schedule: one bundle frame every 5 ET minutes across [startEt, endEt]. */
export function syntheticSpxFrames({ startEt = RTH_OPEN_ET, endEt = RTH_LAST_ET } = {}) {
  const frames = [];
  const from = startEt ?? RTH_OPEN_ET;
  const to = endEt ?? RTH_LAST_ET;
  for (let m = from; m <= to; m += 5) frames.push({ etMinute: m, payload: buildBundleAt(m) });
  return frames;
}

/** Structural validity check mirroring src/lib/platform/spx-sim-desk.ts isSpxSimDeskBundle —
 *  the SAME contract the admin ingest endpoint enforces. Used by --dry-run + the unit test. */
export function isValidSpxSimBundle(v) {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  for (const lane of ["bootstrap", "desk", "pulse", "flow", "play", "pin", "gexHeatmap"]) {
    if (v[lane] === undefined) continue;
    if (!v[lane] || typeof v[lane] !== "object" || Array.isArray(v[lane])) return false;
  }
  return true;
}
