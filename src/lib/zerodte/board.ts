// 0DTE Command board — pure aggregation logic. Composes the EXISTING graded engines
// (SPX play / lotto / power hour) and the live HELIX tape into one ranked intraday
// board. Deliberately deterministic and read-only: full plays (entry/stop/target)
// come ONLY from the engines that already grade themselves into the track record;
// single-name flow reads are surfaced as SETUPS (direction + strike + evidence),
// never as fabricated entries — the same honesty rule the rest of the desk follows.
//
// Everything here is a pure function of its inputs (rows, clock) so it is unit-
// testable without providers; the API route does the fetching.

export type SessionHeatState =
  | "PRE_MARKET" // before 9:30 ET — system warming: feeds, morning confirm, lotto scan
  | "OPENING_DRIVE" // 9:30-10:00 ET — heating up: ranges forming, engines arming
  | "RTH" // 10:00-15:00 ET — fully hot
  | "POWER_HOUR" // 15:00-15:30 ET — power-hour engine window
  | "LATE_SESSION" // 15:30-16:00 ET — winding down, no fresh entries
  | "CLOSED"; // outside RTH — hand off to Night Hawk

export type SessionHeat = {
  state: SessionHeatState;
  label: string;
  /** 0-100 "how hot is the desk" meter for the header visual. */
  heat_pct: number;
  note: string;
};

/** ET clock → heat state. `etMinutes` = minutes since midnight ET; weekday/holiday
 *  gating happens upstream (callers pass isTradingDay). */
export function sessionHeat(etMinutes: number, isTradingDay: boolean): SessionHeat {
  if (!isTradingDay) {
    return {
      state: "CLOSED",
      label: "Market closed",
      heat_pct: 0,
      note: "No session today — Night Hawk's evening playbook covers the next open.",
    };
  }
  const OPEN = 9 * 60 + 30;
  const TEN = 10 * 60;
  const PH = 15 * 60;
  const PH_END = 15 * 60 + 30;
  const CLOSE = 16 * 60;

  if (etMinutes < OPEN) {
    // Ramp 0→40 across the 2h before the open so the meter visibly "warms".
    const ramp = Math.max(0, Math.min(1, (etMinutes - (OPEN - 120)) / 120));
    return {
      state: "PRE_MARKET",
      label: "Warming up",
      heat_pct: Math.round(40 * ramp),
      note: "Pre-market: feeds warming, overnight plays confirming, lotto scan pending.",
    };
  }
  if (etMinutes < TEN) {
    return {
      state: "OPENING_DRIVE",
      label: "Opening drive",
      heat_pct: 70,
      note: "Ranges forming — engines arming. Best entries usually come after 9:50.",
    };
  }
  if (etMinutes < PH) {
    return {
      state: "RTH",
      label: "Desk hot",
      heat_pct: 100,
      note: "All engines live — plays fire when gates align.",
    };
  }
  if (etMinutes < PH_END) {
    return {
      state: "POWER_HOUR",
      label: "Power hour",
      heat_pct: 100,
      note: "Power-hour engine window — closing-drive setups.",
    };
  }
  if (etMinutes < CLOSE) {
    return {
      state: "LATE_SESSION",
      label: "Winding down",
      heat_pct: 50,
      note: "Late session — managing open risk, no fresh entries.",
    };
  }
  return {
    state: "CLOSED",
    label: "Session closed",
    heat_pct: 0,
    note: "Session done — Night Hawk builds tomorrow's playbook after the close.",
  };
}

// ── Single-name 0DTE flow setups (evidence, not fabricated plays) ────────────────

export type FlowSetupInput = {
  ticker: string;
  premium: number;
  option_type: string;
  strike: number;
  expiry: string;
  dte?: number;
  alert_rule?: string;
  ask_pct?: number;
  underlying_price?: number;
  alerted_at: string;
};

export type ZeroDteSetup = {
  ticker: string;
  direction: "long" | "short";
  /** Dominant strike by premium on the dominant side. */
  top_strike: number;
  expiry: string;
  dte: number;
  net_premium: number;
  gross_premium: number;
  prints: number;
  sweep_pct: number;
  /** Premium-weighted dominance of the winning side (0.5-1). */
  side_dominance: number;
  underlying_price: number | null;
  /** 0-100 deterministic evidence score (premium tiers + sweeps + dominance + breadth). */
  score: number;
  first_seen: string | null;
  last_seen: string | null;
};

const SETUP_MIN_GROSS = 750_000; // ignore thin names — this is a "best of the tape" board
const SETUP_MIN_DOMINANCE = 0.65; // two-sided tape is a fade signal, not a setup
const SETUP_MAX_DTE = 1; // 0DTE board: today + tomorrow expiries only

/**
 * Derive ranked single-name setups from HELIX tape rows. Index products should be
 * excluded upstream (SPX has its own engines on this board).
 */
export function deriveZeroDteSetups(
  rows: FlowSetupInput[],
  opts?: { maxSetups?: number; excludeTickers?: Set<string> }
): ZeroDteSetup[] {
  const maxSetups = opts?.maxSetups ?? 8;
  type Agg = {
    call: number;
    put: number;
    sweep: number;
    gross: number;
    prints: number;
    strikes: Map<string, { prem: number; strike: number; expiry: number; isCall: boolean }>;
    underlying: number | null;
    firstSeen: string | null;
    lastSeen: string | null;
    minDte: number;
  };
  const byTicker = new Map<string, Agg>();

  for (const r of rows) {
    const ticker = r.ticker?.toUpperCase();
    if (!ticker || opts?.excludeTickers?.has(ticker)) continue;
    const dte = r.dte ?? null;
    if (dte == null || dte > SETUP_MAX_DTE || dte < 0) continue;
    const prem = r.premium;
    if (!(prem > 0)) continue;

    const agg =
      byTicker.get(ticker) ??
      ({
        call: 0,
        put: 0,
        sweep: 0,
        gross: 0,
        prints: 0,
        strikes: new Map(),
        underlying: null,
        firstSeen: null,
        lastSeen: null,
        minDte: SETUP_MAX_DTE,
      } as Agg);

    const isCall = (r.option_type ?? "").toLowerCase().startsWith("c");
    if (isCall) agg.call += prem;
    else agg.put += prem;
    agg.gross += prem;
    agg.prints += 1;
    if ((r.alert_rule ?? "").toLowerCase().includes("sweep")) agg.sweep += prem;
    if (r.underlying_price && r.underlying_price > 0) agg.underlying = r.underlying_price;
    agg.minDte = Math.min(agg.minDte, dte);
    const key = `${r.strike}|${r.expiry}|${isCall ? "c" : "p"}`;
    const cur = agg.strikes.get(key);
    if (cur) cur.prem += prem;
    else agg.strikes.set(key, { prem, strike: r.strike, expiry: Date.parse(r.expiry) || 0, isCall });
    if (r.alerted_at) {
      if (!agg.firstSeen || r.alerted_at < agg.firstSeen) agg.firstSeen = r.alerted_at;
      if (!agg.lastSeen || r.alerted_at > agg.lastSeen) agg.lastSeen = r.alerted_at;
    }
    byTicker.set(ticker, agg);
  }

  const setups: ZeroDteSetup[] = [];
  for (const [ticker, agg] of Array.from(byTicker.entries())) {
    if (agg.gross < SETUP_MIN_GROSS) continue;
    const dominantCall = agg.call >= agg.put;
    const winning = dominantCall ? agg.call : agg.put;
    const dominance = agg.gross > 0 ? winning / agg.gross : 0;
    if (dominance < SETUP_MIN_DOMINANCE) continue;

    // Dominant strike on the winning side.
    let top: { prem: number; strike: number; expiry: number } | null = null;
    let topExpiry = "";
    for (const [key, s] of Array.from(agg.strikes.entries())) {
      if (s.isCall !== dominantCall) continue;
      if (!top || s.prem > top.prem) {
        top = s;
        topExpiry = key.split("|")[1] ?? "";
      }
    }
    if (!top) continue;

    const sweepPct = agg.gross > 0 ? agg.sweep / agg.gross : 0;
    // Evidence score: premium tiers (0-40) + dominance (0-25) + sweeps (0-20) + prints (0-15).
    let score = 0;
    if (agg.gross >= 10_000_000) score += 40;
    else if (agg.gross >= 5_000_000) score += 32;
    else if (agg.gross >= 2_000_000) score += 24;
    else if (agg.gross >= 1_000_000) score += 16;
    else score += 8;
    score += Math.round(((dominance - 0.5) / 0.5) * 25);
    score += Math.round(sweepPct * 20);
    score += Math.min(15, agg.prints);

    setups.push({
      ticker,
      direction: dominantCall ? "long" : "short",
      top_strike: top.strike,
      expiry: topExpiry,
      dte: agg.minDte,
      net_premium: agg.call - agg.put,
      gross_premium: agg.gross,
      prints: agg.prints,
      sweep_pct: Math.round(sweepPct * 100) / 100,
      side_dominance: Math.round(dominance * 100) / 100,
      underlying_price: agg.underlying,
      score: Math.max(0, Math.min(100, score)),
      first_seen: agg.firstSeen,
      last_seen: agg.lastSeen,
    });
  }

  return setups.sort((a, b) => b.score - a.score).slice(0, maxSetups);
}

// ── Engine card ranking ───────────────────────────────────────────────────────────

export type EngineCard = {
  kind: "spx_play" | "lotto" | "power_hour";
  /** ACTIVE = live managed play; ARMED = ready/near-trigger; SCANNING = watching; DONE/OFF. */
  state: "ACTIVE" | "ARMED" | "SCANNING" | "DONE" | "OFF";
  rank: number;
};

/**
 * Deterministic ordering for the engine cards: an ACTIVE managed play always leads,
 * ARMED engines next (lotto before power-hour outside 15:00-15:30, reversed inside
 * the window), then scanning states.
 */
export function rankEngineCards(
  cards: Array<Omit<EngineCard, "rank">>,
  inPowerHourWindow: boolean
): EngineCard[] {
  const stateOrder: Record<EngineCard["state"], number> = {
    ACTIVE: 0,
    ARMED: 1,
    SCANNING: 2,
    DONE: 3,
    OFF: 4,
  };
  const kindOrder = (k: EngineCard["kind"]): number => {
    if (k === "spx_play") return 0;
    if (inPowerHourWindow) return k === "power_hour" ? 1 : 2;
    return k === "lotto" ? 1 : 2;
  };
  return [...cards]
    .sort((a, b) => stateOrder[a.state] - stateOrder[b.state] || kindOrder(a.kind) - kindOrder(b.kind))
    .map((c, i) => ({ ...c, rank: i + 1 }));
}

// ── Dossier enrichment (the "very strong" layer) ─────────────────────────────────
// The top setups get the FULL Night Hawk dossier treatment — the same enrichment +
// direction-correct deterministic scorer the evening edition uses: flow streaks,
// strike stacks, Polygon technicals (breakouts/MA stacks/RSI/rel-vol), dark pool,
// OI change, skew, news/catalysts, analyst PT, congress/institutional, fundamentals.
// This function is the PURE merge of a fetched dossier onto a flow setup, so it is
// unit-testable with a fake dossier; the route does the (cached) fetching.

import { computeFibLevels, nearestFibNote, type FibNote } from "./fib";

/** Structural subset of TickerDossier the enrichment reads (keeps this module
 *  provider-import-free and the merge testable with plain objects). */
export type SetupDossierView = {
  tech?: {
    price: number;
    trend: string;
    setup_tags: string[];
    breakout_zones: string[];
    weekly: { high: number | null; low: number | null };
    prior_day: { high: number | null; low: number | null; close: number | null };
    rsi14: number | null;
    rel_volume: number | null;
    atr14: number | null;
  } | null;
  dark_pool?: { total_premium?: number; bias?: string } | null;
  flow_streak?: { streak_days: number; direction: "long" | "short" | "mixed" } | null;
  scored?: {
    score: number;
    direction: "long" | "short";
    conviction: string;
    flow_score: number;
    tech_score: number;
    pos_score: number;
    news_score: number;
    smart_money_score: number;
    catalyst_flags?: string[];
  } | null;
  trading_halt?: boolean;
};

export type EnrichedZeroDteSetup = ZeroDteSetup & {
  /** Full deterministic dossier score (0-100) + conviction from the audited scorer. */
  dossier_score: number | null;
  conviction: string | null;
  /** Whether the dossier's flow-lane direction agrees with the live-tape read. */
  direction_confirmed: boolean | null;
  factor_breakdown: {
    flow: number;
    tech: number;
    positioning: number;
    news: number;
    smart_money: number;
  } | null;
  trend: string | null;
  tech_tags: string[];
  breakout_zones: string[];
  rsi14: number | null;
  rel_volume: number | null;
  streak_days: number | null;
  dark_pool_bias: string | null;
  catalyst_flags: string[];
  /** Fib annotation vs the weekly swing, when price sits at a level. */
  fib_note: FibNote | null;
  halted: boolean;
};

export function enrichSetup(setup: ZeroDteSetup, dossier: SetupDossierView | null): EnrichedZeroDteSetup {
  const scored = dossier?.scored ?? null;
  const tech = dossier?.tech ?? null;

  // Weekly-swing fibs, oriented by the setup direction: a long retraces the up-swing
  // (dip-buy levels); a short retraces the down-swing (pop-short levels).
  let fibNote: FibNote | null = null;
  const price = setup.underlying_price ?? tech?.price ?? null;
  if (price && tech?.weekly.high && tech.weekly.low) {
    const levels = computeFibLevels(
      tech.weekly.low,
      tech.weekly.high,
      setup.direction === "long" ? "up" : "down"
    );
    fibNote = nearestFibNote(price, levels);
  }

  return {
    ...setup,
    dossier_score: scored?.score ?? null,
    conviction: scored?.conviction ?? null,
    direction_confirmed: scored ? scored.direction === setup.direction : null,
    factor_breakdown: scored
      ? {
          flow: scored.flow_score,
          tech: scored.tech_score,
          positioning: scored.pos_score,
          news: scored.news_score,
          smart_money: scored.smart_money_score,
        }
      : null,
    trend: tech?.trend ?? null,
    tech_tags: tech?.setup_tags ?? [],
    breakout_zones: tech?.breakout_zones ?? [],
    rsi14: tech?.rsi14 ?? null,
    rel_volume: tech?.rel_volume ?? null,
    streak_days: dossier?.flow_streak?.streak_days ?? null,
    dark_pool_bias: dossier?.dark_pool?.bias ?? null,
    catalyst_flags: scored?.catalyst_flags ?? [],
    fib_note: fibNote,
    halted: dossier?.trading_halt === true,
  };
}
