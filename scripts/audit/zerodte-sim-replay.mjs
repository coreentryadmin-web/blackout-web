/**
 * 0DTE SIMULATOR — Level-1 snapshot REPLAYER (Night Hawk board).
 *
 * WHAT. Writes valid `ZeroDteBoardPayload` snapshots to the Redis key the live board UI
 * reads (`zerodte:board:snapshot:v1`), plus matching per-contract live marks
 * (`nw:optmark:<OCC>`), on a VIRTUAL CLOCK — so the REAL 0DTE panel renders a whole
 * session evolving (WATCH → commit at 10:00 → intraday P&L with trims → green exits +
 * one stopped loser) WITHOUT any live market data, provider call, or DB write.
 *
 * WHY (Level-1, not Level-2). The board route (`/api/market/zerodte/board`) serves the
 * shared Redis snapshot VERBATIM (`getZeroDteBoardPayload` reads the key and returns it;
 * it does NOT re-run the scan/grader on a Redis-read snapshot — see
 * src/lib/platform/zerodte-service.ts getZeroDteBoardPayload). So publishing that key IS
 * the whole render. This replays PRE-BAKED snapshots; it does not run the pipeline. The
 * full-pipeline-on-a-virtual-clock version is Level-2 (see docs/audit/ZERODTE-SIMULATOR.md
 * §Clock-seam for the seam that unlocks it).
 *
 * SEAMS (verified in code, 2026-07-25):
 *  - Board: Redis `blackout:zerodte:board:snapshot:v1` = JSON.stringify(ZeroDteBoardPayload)
 *    (sharedCacheSet prefixes every key with `blackout:` — src/lib/shared-cache.ts:120).
 *    Read by getZeroDteBoardPayload → served by the board route to the SWR-polling panel.
 *  - Marks: Redis `blackout:nw:optmark:<OCC>` = JSON.stringify({bid,ask,mark,last,ts})
 *    (OptionMark — src/lib/ws/options-socket.ts:211,235). Read by getLiveOptionMark. NOTE:
 *    the SSE marks frame (getZeroDteLiveMarksFrame, live-marks.ts) also needs a DB ledger
 *    row per OCC to SURFACE a mark (it derives the tracked set from fetchZeroDteSetupLog),
 *    which this tool deliberately does NOT create. The board snapshot's own ledger rows
 *    already carry last_mark / live_pnl_pct / peak / trough, so the PANEL animates fully
 *    from the snapshot alone; the nw:optmark writes are a best-effort bonus that light up
 *    the SSE lane only on a scratch env that also has matching ledger rows. See the doc.
 *
 * SAFETY. Touches ONLY three Redis key families under the app prefix:
 * `zerodte:board:snapshot:v1`, `nw:optmark:*`, and its own sidecar marker
 * `zerodte:sim:marker:v1`. It REFUSES to run against a Redis that already holds a
 * live-looking board snapshot NOT written by this tool (no sim marker) unless `--force`.
 * That refusal covers BOTH the publish path and `--reset` (the destructive one).
 * It NEVER touches Postgres or any provider API. Point it at a NON-prod / scratch Redis.
 *
 * USAGE. `node scripts/audit/zerodte-sim-replay.mjs --synthetic --speed=30 --redis=redis://localhost:6379`
 *        `node scripts/audit/zerodte-sim-replay.mjs --replay=session.json --speed=60`
 *        `node scripts/audit/zerodte-sim-replay.mjs --synthetic --dry-run`   (prints, writes nothing)
 *        `node scripts/audit/zerodte-sim-replay.mjs --reset --redis=...`     (clears the keys)
 *        `node scripts/audit/zerodte-sim-replay.mjs --help`
 */

// ── Redis key families (the ONLY keys this tool ever writes) ───────────────────────
// sharedCacheSet stores under `blackout:<key>`; the app prefix is overridable via
// --key-prefix so a scratch app configured with a different namespace still matches.
const DEFAULT_APP_PREFIX = "blackout:";
const BOARD_KEY = "zerodte:board:snapshot:v1";
const MARK_PREFIX = "nw:optmark:";
const SIM_MARKER_KEY = "zerodte:sim:marker:v1"; // sidecar: proves a snapshot is ours

// TTLs mirror the app's own (BOARD_SNAPSHOT_TTL_SEC=60; MARK_REDIS_TTL_SEC ~ short). We
// refresh every tick so a generous TTL just avoids a mid-tick expiry blank.
const BOARD_TTL_SEC = 60;
const MARK_TTL_SEC = 60;
const MARKER_TTL_SEC = 3600;

// RTH window (ET minutes since midnight).
const COMMIT_ET = 10 * 60; // 600 — G-2 unlock; fresh commits allowed at/after 10:00

// Synthetic session runs a touch before the open (to show warming WATCH cards) through
// just past power-hour close of the last play.
const SIM_START_ET = 9 * 60 + 45; // 585 — WATCH cards visible pre-commit
const SIM_END_ET = 15 * 60 + 50; // 950 — a hair past the last exit

// ────────────────────────────────────────────────────────────────────────────────────
// Arg parsing
// ────────────────────────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const args = {
    synthetic: false,
    replay: null,
    speed: 30,
    redis: process.env.REDIS_URL || null,
    dryRun: false,
    reset: false,
    force: false,
    keyPrefix: DEFAULT_APP_PREFIX,
    help: false,
    startEt: SIM_START_ET,
    endEt: SIM_END_ET,
  };
  for (const raw of argv) {
    if (raw === "--help" || raw === "-h") args.help = true;
    else if (raw === "--synthetic") args.synthetic = true;
    else if (raw === "--dry-run") args.dryRun = true;
    else if (raw === "--reset") args.reset = true;
    else if (raw === "--force") args.force = true;
    else if (raw.startsWith("--replay=")) args.replay = raw.slice("--replay=".length);
    else if (raw.startsWith("--speed=")) args.speed = Number(raw.slice("--speed=".length));
    else if (raw.startsWith("--redis=")) args.redis = raw.slice("--redis=".length);
    else if (raw.startsWith("--key-prefix=")) args.keyPrefix = raw.slice("--key-prefix=".length);
    else if (raw.startsWith("--start-et=")) args.startEt = parseEtLabel(raw.slice("--start-et=".length));
    else if (raw.startsWith("--end-et=")) args.endEt = parseEtLabel(raw.slice("--end-et=".length));
    else throw new Error(`unknown flag: ${raw}`);
  }
  if (!Number.isFinite(args.speed) || args.speed <= 0) throw new Error("--speed must be a positive number");
  return args;
}

const HELP = `0DTE SIMULATOR — Level-1 snapshot replayer (Night Hawk board)

Writes ZeroDteBoardPayload snapshots (+ nw:optmark marks) to a target Redis on a virtual
clock so the REAL 0DTE UI panel renders a session evolving — no live market data.

MODES (exactly one of --synthetic / --replay / --reset):
  --synthetic          Generate a plausible WINNING session: 5 WATCH finds pre-10:00,
                       commit at 10:00 (FLOW / BREAKOUT / PIN + one condor), intraday P&L
                       with 1/3@+25% / 1/3@+50% trims, green exits, one stopped loser.
  --replay=<file.json> Replay recorded board snapshots on the clock. Schema:
                         { "frames": [ { "et": "10:05"|605, "board": <ZeroDteBoardPayload>,
                                         "marks": { "<OCC>": {bid,ask,mark,last} } }, ... ] }
                       Each frame publishes when the virtual clock reaches its ET; last wins.
  --reset              Delete the board snapshot, all nw:optmark:* marks, and the sim marker.
                       Subject to the same foreign-snapshot refusal as publishing.

FLAGS:
  --speed=N            Virtual seconds per real second (default 30 -> ~1 RTH day in ~13 min).
  --redis=<url>        Target Redis (default $REDIS_URL). MUST be non-prod / scratch.
  --key-prefix=<p>     App key prefix (default "blackout:" — what sharedCacheSet uses).
  --dry-run            Print the frame timeline + validate payloads; write NOTHING (no Redis).
  --force              Override the "live-looking foreign snapshot" safety refusal.
  --start-et=HH:MM     Synthetic window start (default 09:45).
  --end-et=HH:MM       Synthetic window end   (default 15:50).
  -h, --help           This help.

SAFETY: touches ONLY zerodte:board:snapshot:v1, nw:optmark:*, zerodte:sim:marker:v1.
Never Postgres, never a provider API. Refuses a Redis holding a foreign live snapshot
unless --force. Requires Redis + the app running on a browser-capable env to see pixels.
`;

// ────────────────────────────────────────────────────────────────────────────────────
// Pure helpers (replicated from src so the script has no app-import graph)
// ────────────────────────────────────────────────────────────────────────────────────
function parseEtLabel(s) {
  if (/^\d+$/.test(String(s))) return Number(s); // already minutes
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s));
  if (!m) throw new Error(`bad ET label: ${s} (want HH:MM or minutes)`);
  return Number(m[1]) * 60 + Number(m[2]);
}
function etLabel(mins) {
  const h = Math.floor(mins / 60);
  const m = Math.floor(mins % 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
function round2(n) {
  return Math.round(n * 100) / 100;
}
function pnlPct(entry, mark) {
  if (entry == null || mark == null || entry === 0) return null;
  return round2(((mark - entry) / entry) * 100);
}

/** sessionHeat — byte-for-byte the logic in src/lib/zerodte/board.ts:29. */
function sessionHeat(etMinutes, isTradingDay) {
  if (!isTradingDay) {
    return { state: "CLOSED", label: "Market closed", heat_pct: 0, note: "No session today — Night Hawk's evening playbook covers the next open." };
  }
  const OPEN = 9 * 60 + 30, TEN = 10 * 60, PH = 15 * 60, PH_END = 15 * 60 + 30, CLOSE = 16 * 60;
  if (etMinutes < OPEN) {
    const ramp = Math.max(0, Math.min(1, (etMinutes - (OPEN - 120)) / 120));
    return { state: "PRE_MARKET", label: "Warming up", heat_pct: Math.round(40 * ramp), note: "Pre-market: feeds warming, overnight plays confirming, lotto scan pending." };
  }
  if (etMinutes < TEN) return { state: "OPENING_DRIVE", label: "Opening drive", heat_pct: 70, note: "Ranges forming — engines arming. Best entries usually come after 9:50." };
  if (etMinutes < PH) return { state: "RTH", label: "Desk hot", heat_pct: 100, note: "All engines live — plays fire when gates align." };
  if (etMinutes < PH_END) return { state: "POWER_HOUR", label: "Power hour", heat_pct: 100, note: "Power-hour engine window — closing-drive setups." };
  if (etMinutes < CLOSE) return { state: "LATE_SESSION", label: "Winding down", heat_pct: 50, note: "Late session — managing open risk, no fresh entries." };
  return { state: "CLOSED", label: "Session closed", heat_pct: 0, note: "Session done — Night Hawk builds tomorrow's playbook after the close." };
}

/** buildOcc — mirrors src/lib/ws/options-socket.ts:299 (SPX->SPXW, O: prefix, 8-digit strike). */
function buildOcc(ticker, expiry, optionType, strike) {
  const rawRoot = String(ticker).trim().toUpperCase();
  if (!rawRoot) return null;
  const root = rawRoot === "SPX" ? "SPXW" : rawRoot;
  if (!/^[A-Z]{1,6}$/.test(root)) return null;
  const ymd = expiry.slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return null;
  const date = `${m[1].slice(2)}${m[2]}${m[3]}`;
  const cp = optionType === "call" ? "C" : optionType === "put" ? "P" : null;
  if (!cp) return null;
  const strike8 = String(Math.round(strike * 1000)).padStart(8, "0");
  return `O:${root}${date}${cp}${strike8}`;
}

/** todayEt (ET calendar date) — same Intl approach as src/features/nighthawk/lib/session.ts. */
function todayEt() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
}

// ────────────────────────────────────────────────────────────────────────────────────
// Synthetic session model
// ────────────────────────────────────────────────────────────────────────────────────
// Each play carries a premium TIMELINE (control points in ET minutes) that the model
// linearly interpolates into a smooth mark, plus a lifecycle: WATCH pre-commit, OPEN at
// entry, TRIM after the first scale, CLOSED at exit. Winners exit green; the loser stops.

/** Interpolate a value from ascending [etMin, value] control points (clamped at ends). */
function interp(points, et) {
  if (et <= points[0][0]) return points[0][1];
  if (et >= points[points.length - 1][0]) return points[points.length - 1][1];
  for (let i = 1; i < points.length; i++) {
    const [t0, v0] = points[i - 1];
    const [t1, v1] = points[i];
    if (et <= t1) return v0 + ((v1 - v0) * (et - t0)) / (t1 - t0);
  }
  return points[points.length - 1][1];
}

function syntheticPlays(sessionDate, expiry) {
  // strike/type/entry + a premium curve. trims[] = ET minutes at which a 1/3 scale fires
  // (first trim flips status OPEN->TRIM). exitEt = CLOSE; exit kind drives closed_reason.
  return [
    {
      ticker: "NVDA", direction: "long", type: "call", origin: ["FLOW"], playType: "DIRECTIONAL",
      strike: 182, underlying_at_flag: 179.4, entry: 3.2,
      curve: [[600, 3.2], [620, 4.0], [650, 4.85], [690, 5.25], [750, 5.95], [800, 5.8], [810, 5.78]],
      trims: [620, 650], exitEt: 810, exitKind: "ratchet", score: 82,
      exitDetail: "Mark 5.78 (+81%) rode the +50% floor to a power-hour fade — banked the runner green.",
    },
    {
      ticker: "TSLA", direction: "long", type: "call", origin: ["BREAKOUT"], playType: "DIRECTIONAL",
      strike: 340, underlying_at_flag: 336.1, entry: 2.5,
      curve: [[600, 2.5], [630, 3.05], [660, 3.18], [720, 3.42], [820, 3.55], [840, 3.5]],
      trims: [660], exitEt: 840, exitKind: "ratchet", score: 74,
      exitDetail: "Mark 3.50 (+40%) fell to the armed +20% floor after the 14:00 stall — closed green.",
    },
    {
      ticker: "META", direction: "long", type: "call", origin: ["FLOW", "BREAKOUT"], playType: "DIRECTIONAL",
      strike: 720, underlying_at_flag: 714.8, entry: 1.9,
      curve: [[600, 1.9], [640, 2.25], [700, 2.45], [780, 2.5], [790, 2.47]],
      trims: [640], exitEt: 790, exitKind: "target", score: 78,
      exitDetail: "Mark 2.47 (+30%) — dual-origin (flow+breakout) confluence winner, scaled + banked.",
    },
    {
      // Condor: PIN origin, play_type CONDOR. Nominal direction "short" on the ledger row;
      // premium seller — modeled as CREDIT decay (mark = current buyback cost), P&L set
      // directly as the short-side gain (credit is not the -50/+100 long grader).
      ticker: "SPX", direction: "short", type: "call", origin: ["PIN"], playType: "CONDOR",
      strike: 5850, underlying_at_flag: 5842.0, entry: 5.0, condor: true,
      // buyback cost decays toward 0 as the pin holds -> P&L = (entry-mark)/entry.
      curve: [[600, 5.0], [660, 4.1], [720, 3.2], [810, 2.2], [900, 1.4], [930, 1.2]],
      trims: [720], exitEt: 930, exitKind: "time_stop", score: 71,
      exitDetail: "Pin held both shorts into the 15:30 time-stop — kept 76% of the sold credit.",
    },
    {
      // The stopped loser (realism): AMD long put that goes the wrong way and hits -50%.
      ticker: "AMD", direction: "long", type: "put", origin: ["FLOW"], playType: "DIRECTIONAL",
      strike: 168, underlying_at_flag: 170.2, entry: 1.8,
      curve: [[600, 1.8], [630, 1.5], [650, 1.2], [670, 0.95], [675, 0.9]],
      trims: [], exitEt: 675, exitKind: "stopped", score: 69,
      exitDetail: "Mark 0.90 (-50%) tripped the hard stop — underlying reclaimed VWAP against the put.",
    },
  ].map((p) => ({ ...p, expiry, occ: buildOcc(p.ticker, expiry, p.type, p.strike) }));
}

/** Premium mark for a play at ET `et` (null before entry). */
function markAt(play, et) {
  if (et < COMMIT_ET) return null;
  const cappedEt = et > play.exitEt ? play.exitEt : et; // freeze at the exit
  return round2(interp(play.curve, cappedEt));
}

/** Latched extremes over [entry, et] sampled along the curve control points. */
function extremesTo(play, et) {
  const upper = Math.min(et, play.exitEt);
  let peak = play.entry, trough = play.entry;
  for (let t = COMMIT_ET; t <= upper; t += 5) {
    const m = round2(interp(play.curve, t));
    if (m > peak) peak = m;
    if (m < trough) trough = m;
  }
  return { peak: round2(peak), trough: round2(trough) };
}

/** The live P&L a ledger row should DISPLAY at ET `et`. Long: (mark-entry)/entry. Condor
 *  short-credit: (entry-mark)/entry (buyback decay = gain, so a falling mark is profit).
 *  Stopped: pinned -50. */
function displayPnl(play, et, mark) {
  if (et >= play.exitEt && play.exitKind === "stopped") return -50; // PLAN_RULES.stop_pct
  if (play.condor) return mark == null ? null : round2(-pnlPct(play.entry, mark)); // (entry-mark)/entry
  return pnlPct(play.entry, mark);
}

/** Ratchet floor guidance (mirrors ratchetFloorPct intent): armed only once peak gain >= +25%. */
function ratchetFloor(play, et) {
  const { peak, trough } = extremesTo(play, et);
  // Long: best is the highest mark (peak). Condor short-credit: best is the LOWEST buyback (trough).
  const peakPct = play.condor ? round2(-pnlPct(play.entry, trough)) : pnlPct(play.entry, peak);
  if (peakPct == null || peakPct < 25) return null;
  if (peakPct >= 100) return 50;
  if (peakPct >= 50) return 20;
  return 0; // breakeven floor
}

function statusAt(play, et) {
  if (et < COMMIT_ET) return "WATCH";
  if (et >= play.exitEt) return "CLOSED";
  if (play.trims.length && et >= play.trims[0]) return "TRIM";
  return "OPEN";
}

// ── Build one WATCH setup (pre-commit) — a minimal-but-VALID EnrichedZeroDteSetup ─────
function buildWatchSetup(play, et) {
  const spot = play.underlying_at_flag;
  const otm = spot ? round2(((play.strike - spot) / spot) * 100) * (play.type === "put" ? -1 : 1) : null;
  const gate = {
    verdict: "BLOCKED",
    blocks: [
      { code: "post_10am_only", reason: "Fresh 0DTE commits unlock at 10:00 ET — engines still arming.", threshold: 600, unlock_et: "10:00" },
    ],
    calibration: {
      score_at_commit: play.score,
      market_bias: "up",
      committed_at_et: etLabel(et),
      g4_vix: { day_open_vix: 14.2, tier: "normal", would_block: false, would_halve_size: false, note: "VIX 14.2 — normal regime." },
      g6_conflict: { conflict: false, against: [], would_block: false, note: "No system conflict." },
    },
  };
  const plan = {
    occ: play.occ,
    flow_avg_fill: play.entry,
    bid: round2(play.entry - 0.05),
    ask: round2(play.entry + 0.05),
    mark: play.entry,
    entry_max: play.entry,
    vs_flow_pct: 0,
    entry_status: "IN_RANGE",
    spread_pct: round2((0.1 / play.entry) * 100),
    illiquid: false,
    quote_invalid_reason: null,
    stop_premium: round2(play.entry * 0.5),
    target_premium: round2(play.entry * 2),
    time_stop_et: "15:30",
    underlying_target: spot ? round2(spot * (play.type === "put" ? 0.985 : 1.015)) : null,
    underlying_invalid: spot ? round2(spot * (play.type === "put" ? 1.005 : 0.995)) : null,
  };
  return {
    ticker: play.ticker,
    direction: play.direction,
    play_type: play.playType,
    discovery_origin: play.origin,
    top_strike: play.strike,
    expiry: play.expiry,
    dte: 0,
    contract_horizon: "ZERO_DTE",
    actual_dte_at_commit: 0,
    grading_policy: "SAME_DAY_1530",
    net_premium: 1_800_000,
    gross_premium: 2_400_000,
    prints: 42,
    sweep_pct: 0.55,
    side_dominance: 0.78,
    underlying_price: spot,
    score: play.score,
    top_strike_avg_fill: play.entry,
    aggression: 0.62,
    otm_pct: otm,
    new_money: true,
    recent_premium_30m: 900_000,
    spike: true,
    first_seen: new Date().toISOString(),
    last_seen: new Date().toISOString(),
    flow_quality: null,
    // ── EnrichedZeroDteSetup additions ──
    dossier_score: play.score,
    conviction: play.score >= 80 ? "HIGH" : play.score >= 70 ? "MEDIUM" : "LOW",
    direction_confirmed: true,
    factor_breakdown: { flow: 0.5, tech: 0.2, positioning: 0.15, news: 0.05, smart_money: 0.1 },
    trend: "up",
    tech_tags: play.origin.includes("BREAKOUT") ? ["breakout"] : ["momentum"],
    breakout_zones: [],
    key_supports: spot ? [round2(spot * 0.99), round2(spot * 0.98)] : [],
    key_resistances: spot ? [round2(spot * 1.01), round2(spot * 1.02)] : [],
    vwap: spot ? round2(spot * 0.999) : null,
    atr14: spot ? round2(spot * 0.02) : null,
    rsi14: 58,
    rel_volume: 1.8,
    streak_days: 2,
    dark_pool_bias: null,
    gex_king_strike: play.condor ? play.strike : null,
    gamma_regime: play.condor ? "positive" : null,
    condor: null,
    condor_plan: null,
    intraday: {
      vwap: spot ? round2(spot * 0.999) : null,
      vwap_dist_pct: 0.1,
      or_high: spot ? round2(spot * 1.004) : null,
      or_low: spot ? round2(spot * 0.996) : null,
      or_break: "above",
      trend_5m: "up",
      last: spot,
      day_high: spot ? round2(spot * 1.006) : null,
      day_low: spot ? round2(spot * 0.994) : null,
      last_bar_ms: Date.now(),
    },
    intraday_conflict: false,
    market_aligned: true,
    tod_label: "Opening drive",
    catalyst_flags: [],
    analyst_note: null,
    fib_note: null,
    plan,
    gate,
    cortex: null,
    halted: false,
    earnings: null,
    news_hot: null,
  };
}

// ── Build one committed ledger row at ET `et` ─────────────────────────────────────────
function buildLedgerRow(play, et) {
  const status = statusAt(play, et);
  const mark = markAt(play, et);
  const { peak, trough } = extremesTo(play, et);
  const closed = status === "CLOSED";
  const stopped = closed && play.exitKind === "stopped";
  const displayed = displayPnl(play, et, mark);
  const closedReason = !closed ? null : stopped ? "stopped" : play.exitKind;
  const exitCategory = closed && !stopped ? (play.exitKind === "time_stop" ? null : play.exitKind) : null;
  return {
    ticker: play.ticker,
    direction: play.direction,
    score_max: play.score,
    spike: true,
    first_flagged_at: new Date(Date.now() - (et - COMMIT_ET) * 60_000).toISOString(),
    underlying_at_flag: play.underlying_at_flag,
    top_strike: play.strike,
    expiry: play.expiry,
    conviction: play.score >= 80 ? "HIGH" : play.score >= 70 ? "MEDIUM" : "LOW",
    entry_premium: play.entry,
    flow_avg_fill: play.entry,
    status,
    last_mark: mark,
    peak_premium: peak,
    trough_premium: trough,
    live_pnl_pct: displayed,
    closed_reason: closedReason,
    floor_pnl_pct: closed ? null : ratchetFloor(play, et),
    exit_reason: exitCategory,
    exit_detail: closed ? play.exitDetail : null,
    mark_as_of: mark != null ? new Date().toISOString() : null,
    mark_source: mark != null ? "mid" : null,
    mark_is_sync: false,
    move_pct: null,
    direction_hit: closed ? (stopped ? false : true) : null,
    plan_outcome: null,
    plan_pnl_pct: null,
    graded: false,
    nighthawk_echo: null,
    cortex: null,
    tier: null,
  };
}

/** Build the whole board payload + the marks map for the synthetic session at ET `et`. */
function buildSyntheticBoard(et, sessionDate, plays) {
  // The synthetic session ALWAYS renders as a live trading day — it's a demo of an RTH
  // session, so it must show a hot desk even when run on a weekend/holiday (a real
  // isTradingDayEt(sessionDate) would flip the whole board to CLOSED off-hours).
  const trading = true;
  const heat = sessionHeat(et, trading);
  const committed = et >= COMMIT_ET;
  const setups = committed ? [] : plays.map((p) => buildWatchSetup(p, et));
  const ledger = committed ? plays.map((p) => buildLedgerRow(p, et)) : [];
  const marks = {};
  if (committed) {
    for (const p of plays) {
      const mark = markAt(p, et);
      if (mark == null || !p.occ) continue;
      marks[p.occ] = {
        bid: round2(mark - 0.05),
        ask: round2(mark + 0.05),
        mark,
        last: mark,
        ts: Date.now(), // REAL wall-clock so getLiveOptionMark freshness passes
      };
    }
  }
  const payload = {
    available: true,
    as_of: new Date().toISOString(),
    upstream_ok: true,
    session: { date: sessionDate, trading_day: trading, heat },
    setups,
    ledger,
    covered_elsewhere: [],
    governor: {
      state: "OK",
      open_count: ledger.filter((r) => r.status !== "CLOSED").length,
      max_concurrent: 6,
      day_pnl_pct: null,
      halted: false,
      note: "Session risk nominal — within concurrency + drawdown limits.",
    },
    allocation: [],
  };
  return { payload, marks };
}

// ────────────────────────────────────────────────────────────────────────────────────
// Validation — assert a payload matches the real ZeroDteBoardPayload contract
// ────────────────────────────────────────────────────────────────────────────────────
function fail(errs, msg) {
  errs.push(msg);
}
function isStr(v) { return typeof v === "string"; }
function isNum(v) { return typeof v === "number" && Number.isFinite(v); }
function isBool(v) { return typeof v === "boolean"; }
function numOrNull(v) { return v === null || isNum(v); }
function strOrNull(v) { return v === null || isStr(v); }

const LEDGER_ENUM_CLOSED = new Set(["stopped", "ratchet", "thesis", "flat", "target", "time_stop"]);
const DIRECTIONS = new Set(["long", "short"]);

function validateLedgerRow(r, i, errs) {
  const p = `ledger[${i}]`;
  if (!r || typeof r !== "object") return fail(errs, `${p}: not an object`);
  if (!isStr(r.ticker)) fail(errs, `${p}.ticker not string`);
  if (!DIRECTIONS.has(r.direction)) fail(errs, `${p}.direction invalid`);
  if (!isNum(r.score_max)) fail(errs, `${p}.score_max not number`);
  if (!isBool(r.spike)) fail(errs, `${p}.spike not boolean`);
  if (!isStr(r.first_flagged_at)) fail(errs, `${p}.first_flagged_at not string`);
  if (!numOrNull(r.underlying_at_flag)) fail(errs, `${p}.underlying_at_flag`);
  if (!numOrNull(r.top_strike)) fail(errs, `${p}.top_strike`);
  if (!strOrNull(r.expiry)) fail(errs, `${p}.expiry`);
  if (!strOrNull(r.conviction)) fail(errs, `${p}.conviction`);
  if (!numOrNull(r.entry_premium)) fail(errs, `${p}.entry_premium`);
  if (!numOrNull(r.flow_avg_fill)) fail(errs, `${p}.flow_avg_fill`);
  if (!strOrNull(r.status)) fail(errs, `${p}.status`);
  if (!numOrNull(r.last_mark)) fail(errs, `${p}.last_mark`);
  if (!numOrNull(r.peak_premium)) fail(errs, `${p}.peak_premium`);
  if (!numOrNull(r.trough_premium)) fail(errs, `${p}.trough_premium`);
  if (!numOrNull(r.live_pnl_pct)) fail(errs, `${p}.live_pnl_pct`);
  if (!(r.closed_reason === null || LEDGER_ENUM_CLOSED.has(r.closed_reason))) fail(errs, `${p}.closed_reason invalid: ${r.closed_reason}`);
  if (!numOrNull(r.floor_pnl_pct)) fail(errs, `${p}.floor_pnl_pct`);
  if (!strOrNull(r.exit_detail)) fail(errs, `${p}.exit_detail`);
  if (!strOrNull(r.mark_as_of)) fail(errs, `${p}.mark_as_of`);
  if (!isBool(r.mark_is_sync)) fail(errs, `${p}.mark_is_sync not boolean`);
  if (!isBool(r.graded)) fail(errs, `${p}.graded not boolean`);
  if (!("nighthawk_echo" in r)) fail(errs, `${p}.nighthawk_echo missing`);
  if (!(r.cortex === null || typeof r.cortex === "object")) fail(errs, `${p}.cortex`);
  if (!(r.tier === null || typeof r.tier === "object")) fail(errs, `${p}.tier`);
}

const HORIZONS = new Set(["ZERO_DTE", "ONE_DTE", "WEEKLY_FALLBACK"]);
const PLAY_TYPES = new Set(["DIRECTIONAL", "CONDOR"]);
const ORIGINS = new Set(["FLOW", "BREAKOUT", "PIN"]);

function validateSetup(s, i, errs) {
  const p = `setups[${i}]`;
  if (!s || typeof s !== "object") return fail(errs, `${p}: not an object`);
  if (!isStr(s.ticker)) fail(errs, `${p}.ticker`);
  if (!DIRECTIONS.has(s.direction)) fail(errs, `${p}.direction`);
  if (!PLAY_TYPES.has(s.play_type)) fail(errs, `${p}.play_type`);
  if (!Array.isArray(s.discovery_origin) || !s.discovery_origin.every((o) => ORIGINS.has(o))) fail(errs, `${p}.discovery_origin`);
  if (!isNum(s.top_strike)) fail(errs, `${p}.top_strike`);
  if (!isStr(s.expiry)) fail(errs, `${p}.expiry`);
  if (!isNum(s.dte)) fail(errs, `${p}.dte`);
  if (!HORIZONS.has(s.contract_horizon)) fail(errs, `${p}.contract_horizon`);
  if (!isNum(s.actual_dte_at_commit)) fail(errs, `${p}.actual_dte_at_commit`);
  if (!isStr(s.grading_policy)) fail(errs, `${p}.grading_policy`);
  if (!isNum(s.net_premium)) fail(errs, `${p}.net_premium`);
  if (!isNum(s.gross_premium)) fail(errs, `${p}.gross_premium`);
  if (!isNum(s.prints)) fail(errs, `${p}.prints`);
  if (!isNum(s.side_dominance)) fail(errs, `${p}.side_dominance`);
  if (!numOrNull(s.underlying_price)) fail(errs, `${p}.underlying_price`);
  if (!isNum(s.score)) fail(errs, `${p}.score`);
  if (!isBool(s.new_money)) fail(errs, `${p}.new_money`);
  if (!isBool(s.spike)) fail(errs, `${p}.spike`);
  // Enriched
  if (!("factor_breakdown" in s)) fail(errs, `${p}.factor_breakdown missing`);
  if (!Array.isArray(s.tech_tags)) fail(errs, `${p}.tech_tags`);
  if (!Array.isArray(s.key_supports)) fail(errs, `${p}.key_supports`);
  if (!Array.isArray(s.key_resistances)) fail(errs, `${p}.key_resistances`);
  if (!Array.isArray(s.catalyst_flags)) fail(errs, `${p}.catalyst_flags`);
  if (!isBool(s.intraday_conflict)) fail(errs, `${p}.intraday_conflict`);
  if (!isBool(s.halted)) fail(errs, `${p}.halted`);
  if (!("plan" in s)) fail(errs, `${p}.plan missing`);
  if (!("gate" in s)) fail(errs, `${p}.gate missing`);
  if (!("cortex" in s)) fail(errs, `${p}.cortex missing`);
  if (!("intraday" in s)) fail(errs, `${p}.intraday missing`);
  if (s.plan && !isStr(s.plan.occ)) fail(errs, `${p}.plan.occ`);
}

export function assertValidBoardPayload(payload) {
  const errs = [];
  if (!payload || typeof payload !== "object") { errs.push("payload not an object"); return errs; }
  if (payload.available !== true) fail(errs, "available !== true");
  if (!isStr(payload.as_of)) fail(errs, "as_of not string");
  if (!isBool(payload.upstream_ok)) fail(errs, "upstream_ok not boolean");
  if (!payload.session || typeof payload.session !== "object") fail(errs, "session missing");
  else {
    if (!isStr(payload.session.date)) fail(errs, "session.date");
    if (!isBool(payload.session.trading_day)) fail(errs, "session.trading_day");
    if (!payload.session.heat || !isStr(payload.session.heat.state)) fail(errs, "session.heat.state");
    if (payload.session.heat && !isNum(payload.session.heat.heat_pct)) fail(errs, "session.heat.heat_pct");
  }
  if (!Array.isArray(payload.setups)) fail(errs, "setups not array");
  else payload.setups.forEach((s, i) => validateSetup(s, i, errs));
  if (!Array.isArray(payload.ledger)) fail(errs, "ledger not array");
  else payload.ledger.forEach((r, i) => validateLedgerRow(r, i, errs));
  if (!Array.isArray(payload.covered_elsewhere)) fail(errs, "covered_elsewhere not array");
  if (!(payload.governor === null || typeof payload.governor === "object")) fail(errs, "governor");
  if (!Array.isArray(payload.allocation)) fail(errs, "allocation not array");
  return errs;
}

// ────────────────────────────────────────────────────────────────────────────────────
// Replay-file loader
// ────────────────────────────────────────────────────────────────────────────────────
async function loadReplayFrames(path) {
  const { readFile } = await import("node:fs/promises");
  const raw = JSON.parse(await readFile(path, "utf8"));
  const frames = Array.isArray(raw) ? raw : raw.frames;
  if (!Array.isArray(frames) || frames.length === 0) throw new Error(`replay file has no frames[]`);
  const out = frames.map((f, i) => {
    const et = typeof f.et === "number" ? f.et : parseEtLabel(f.et);
    if (!f.board || typeof f.board !== "object") throw new Error(`frame[${i}] has no board`);
    const errs = assertValidBoardPayload(f.board);
    if (errs.length) console.warn(`WARN replay frame[${i}] (et=${etLabel(et)}) invalid: ${errs.slice(0, 3).join("; ")}`);
    return { et, board: f.board, marks: f.marks || {} };
  });
  out.sort((a, b) => a.et - b.et);
  return out;
}

// ────────────────────────────────────────────────────────────────────────────────────
// Redis I/O
// ────────────────────────────────────────────────────────────────────────────────────
async function connectRedis(url) {
  const mod = await import("ioredis");
  const Redis = mod.default || mod;
  const client = new Redis(url, { maxRetriesPerRequest: 2, lazyConnect: false });
  await new Promise((resolve, reject) => {
    client.once("ready", resolve);
    client.once("error", reject);
    setTimeout(() => reject(new Error("redis connect timeout")), 8000);
  });
  return client;
}

/** Safety guard: refuse if the target already holds a live-looking board snapshot that
 *  this tool did NOT write (no sim marker). Our own leftover snapshot is always safe. */
export async function assertSafeTarget(client, prefix, force) {
  const existing = await client.get(`${prefix}${BOARD_KEY}`).catch(() => null);
  if (!existing) return;
  const marker = await client.get(`${prefix}${SIM_MARKER_KEY}`).catch(() => null);
  if (marker) return; // our own sim snapshot — safe to overwrite
  let looksLive = false;
  try {
    const snap = JSON.parse(existing);
    const ageMs = Date.now() - Date.parse(snap.as_of);
    const fresh = Number.isFinite(ageMs) && ageMs < 15 * 60_000;
    const hasContent = (snap.ledger?.length || 0) + (snap.setups?.length || 0) > 0;
    looksLive = snap.available === true && (fresh || hasContent);
  } catch {
    looksLive = true; // unparseable but present -> treat as foreign, be conservative
  }
  if (looksLive && !force) {
    throw new Error(
      `REFUSING: ${prefix}${BOARD_KEY} already holds a live-looking board snapshot NOT written by this tool ` +
        `(no sim marker). This looks like a real/prod Redis. Point --redis at a scratch instance, or pass ` +
        `--force if you are certain this Redis is safe to overwrite.`
    );
  }
}

async function publishFrame(client, prefix, payload, marks) {
  const pipe = client.multi();
  pipe.set(`${prefix}${BOARD_KEY}`, JSON.stringify(payload), "EX", BOARD_TTL_SEC);
  pipe.set(`${prefix}${SIM_MARKER_KEY}`, JSON.stringify({ sim: true, wrote_at: new Date().toISOString(), session: payload.session?.date }), "EX", MARKER_TTL_SEC);
  for (const [occ, m] of Object.entries(marks)) {
    pipe.set(`${prefix}${MARK_PREFIX}${occ}`, JSON.stringify(m), "EX", MARK_TTL_SEC);
  }
  await pipe.exec();
}

async function resetKeys(client, prefix) {
  const markKeys = await client.keys(`${prefix}${MARK_PREFIX}*`);
  const pipe = client.multi();
  pipe.del(`${prefix}${BOARD_KEY}`);
  pipe.del(`${prefix}${SIM_MARKER_KEY}`);
  for (const k of markKeys) pipe.del(k);
  await pipe.exec();
  return 2 + markKeys.length;
}

// ────────────────────────────────────────────────────────────────────────────────────
// Main
// ────────────────────────────────────────────────────────────────────────────────────
async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(`arg error: ${e.message}\n\nRun --help for usage.`);
    process.exit(2);
  }
  if (args.help) { console.log(HELP); return; }

  const modes = [args.synthetic, !!args.replay, args.reset].filter(Boolean).length;
  if (modes !== 1) {
    console.error("Specify exactly ONE mode: --synthetic | --replay=<file> | --reset\n\nRun --help.");
    process.exit(2);
  }

  const sessionDate = todayEt();
  const expiry = sessionDate; // 0DTE — today's expiry

  // ── RESET ──────────────────────────────────────────────────────────────────────────
  if (args.reset) {
    if (args.dryRun) { console.log("[dry-run] would delete board snapshot, sim marker, and all nw:optmark:* keys."); return; }
    if (!args.redis) { console.error("--reset needs --redis or REDIS_URL"); process.exit(2); }
    const client = await connectRedis(args.redis);
    // The safety refusal covers DELETE too, not just publish. It used to sit on the publish path
    // only, so `--reset --redis=<prod>` walked straight past it and dropped the live board
    // snapshot plus every nw:optmark:* key — the destructive mode was the one mode the documented
    // guard did not cover.
    try {
      await assertSafeTarget(client, args.keyPrefix, args.force);
    } catch (e) {
      console.error(`\n${e.message}\n`);
      await client.quit();
      process.exit(3);
    }
    const n = await resetKeys(client, args.keyPrefix);
    console.log(`OK reset: deleted ${n} key(s) under prefix "${args.keyPrefix}".`);
    await client.quit();
    return;
  }

  // ── Build the frame TIMELINE (synthetic or replay) ──────────────────────────────────
  let frameAt; // (et) => { payload, marks }
  let startEt, endEt;
  let plays = null;
  if (args.synthetic) {
    plays = syntheticPlays(sessionDate, expiry);
    frameAt = (et) => buildSyntheticBoard(et, sessionDate, plays);
    startEt = args.startEt;
    endEt = args.endEt;
  } else {
    const replayFrames = await loadReplayFrames(args.replay);
    startEt = replayFrames[0].et;
    endEt = replayFrames[replayFrames.length - 1].et;
    frameAt = (et) => {
      // step function: the latest frame whose et <= current virtual et
      let chosen = replayFrames[0];
      for (const f of replayFrames) { if (f.et <= et) chosen = f; else break; }
      return { payload: chosen.board, marks: chosen.marks };
    };
  }

  // ── Validate the WHOLE synthetic arc up front (dry-run's core assertion) ────────────
  if (args.synthetic) {
    let checked = 0, bad = 0;
    for (let et = startEt; et <= endEt; et += 1) {
      const { payload } = frameAt(et);
      const errs = assertValidBoardPayload(payload);
      checked++;
      if (errs.length) { bad++; if (bad <= 3) console.error(`x et=${etLabel(et)} INVALID: ${errs.slice(0, 4).join("; ")}`); }
    }
    console.log(`validation: ${checked} synthetic frames checked, ${bad} invalid.`);
    if (bad > 0) { console.error("payload validation FAILED — aborting."); process.exit(1); }
    console.log("OK every synthetic frame is a valid ZeroDteBoardPayload.\n");
  }

  // ── DRY-RUN: print the timeline, write nothing ──────────────────────────────────────
  if (args.dryRun) {
    console.log(`[dry-run] session ${sessionDate}  window ${etLabel(startEt)}-${etLabel(endEt)}  speed=${args.speed}x`);
    console.log(`[dry-run] would write to prefix "${args.keyPrefix}": ${BOARD_KEY}, ${MARK_PREFIX}<OCC>, ${SIM_MARKER_KEY}\n`);
    const samples = args.synthetic
      ? [585, 595, 600, 621, 651, 676, 700, 791, 811, 841, 931, 945]
      : Array.from({ length: 8 }, (_, i) => Math.round(startEt + ((endEt - startEt) * i) / 7));
    console.log("ET      state         setups  ledger  rows");
    for (const et of samples) {
      if (et < startEt || et > endEt) continue;
      const { payload, marks } = frameAt(et);
      const rows = (payload.ledger || [])
        .map((r) => `${r.ticker}:${r.status}${r.live_pnl_pct != null ? `(${r.live_pnl_pct > 0 ? "+" : ""}${r.live_pnl_pct}%)` : ""}${r.closed_reason ? `/${r.closed_reason}` : ""}`)
        .join(" ");
      const label = `${etLabel(et)}`;
      console.log(`${label.padEnd(7)} ${(payload.session?.heat?.state || "").padEnd(13)} ${String(payload.setups.length).padStart(6)} ${String(payload.ledger.length).padStart(6)}  ${rows || (payload.setups.length ? `WATCH x${payload.setups.length}` : "-")}${Object.keys(marks).length ? `  [marks:${Object.keys(marks).length}]` : ""}`);
    }
    if (args.synthetic) {
      console.log(`\nsynthetic session shape:`);
      for (const p of plays) {
        const kind = p.condor ? "CONDOR/PIN" : `${p.direction} ${p.type}/${p.origin.join("+")}`;
        console.log(`  ${p.ticker.padEnd(5)} ${kind.padEnd(22)} entry ${p.entry}  -> ${p.exitKind.toUpperCase()} @ ${etLabel(p.exitEt)}${p.trims.length ? `  trims @ ${p.trims.map(etLabel).join(",")}` : ""}`);
      }
    }
    console.log("\n[dry-run] no Redis writes performed.");
    return;
  }

  // ── LIVE publish on the virtual clock ───────────────────────────────────────────────
  if (!args.redis) { console.error("Need --redis or REDIS_URL to publish (or use --dry-run)."); process.exit(2); }
  const client = await connectRedis(args.redis);
  try {
    await assertSafeTarget(client, args.keyPrefix, args.force);
  } catch (e) {
    console.error(`\n${e.message}\n`);
    await client.quit();
    process.exit(3);
  }

  console.log(`> publishing ${args.synthetic ? "synthetic" : "replay"} session ${sessionDate} to "${args.redis}"`);
  console.log(`  virtual ${etLabel(startEt)}-${etLabel(endEt)} at ${args.speed}x -> ~${Math.round(((endEt - startEt) / args.speed) * 60)}s real. Prefix "${args.keyPrefix}". Ctrl-C to stop.\n`);

  const realStartMs = Date.now();
  let lastLabel = "";
  const TICK_MS = 1000;
  await new Promise((resolve) => {
    const timer = setInterval(async () => {
      const realElapsedSec = (Date.now() - realStartMs) / 1000;
      const et = startEt + realElapsedSec * args.speed;
      if (et >= endEt) {
        clearInterval(timer);
        const { payload, marks } = frameAt(endEt);
        try { await publishFrame(client, args.keyPrefix, payload, marks); } catch (e) { console.error("publish error:", e.message); }
        console.log(`\nOK ${etLabel(endEt)} — final frame published. Session complete.`);
        resolve();
        return;
      }
      const { payload, marks } = frameAt(et);
      try {
        await publishFrame(client, args.keyPrefix, payload, marks);
      } catch (e) {
        console.error("publish error:", e.message);
      }
      const label = `${etLabel(et)} ${payload.session?.heat?.state || ""}`;
      if (label !== lastLabel) {
        const open = (payload.ledger || []).filter((r) => r.status !== "CLOSED").length;
        const closed = (payload.ledger || []).filter((r) => r.status === "CLOSED").length;
        console.log(`  ${etLabel(et).padEnd(6)} ${(payload.session?.heat?.state || "").padEnd(13)} watch=${payload.setups.length} open=${open} closed=${closed} marks=${Object.keys(marks).length}`);
        lastLabel = label;
      }
    }, TICK_MS);
    process.on("SIGINT", () => { clearInterval(timer); console.log("\n[stopped] keys left in place; run --reset to clear."); resolve(); });
  });

  await client.quit();
}

// Run only when invoked directly (so the .test.mjs can import the pure builders).
import { fileURLToPath } from "node:url";
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  main().catch((e) => { console.error(e); process.exit(1); });
}

export { buildSyntheticBoard, syntheticPlays, buildLedgerRow, buildWatchSetup, sessionHeat, buildOcc, COMMIT_ET, SIM_START_ET, SIM_END_ET };
