// Fold Engine B (Banger) open positions into the Swing Command lane — one ledger, one desk.
//
// Bangers were a parallel whole-market breakout screen with its own board UI; members never got a unified
// entry/exit experience. Swing Command absorbs OPEN/PARTIAL banger_positions as MANAGING plays with a
// BANGER origin badge. Pre-entry banger discovery continues via the banger-discovery cron but surfaces
// here instead of a separate Night Hawk tab.

import type { BangerPositionRow } from "../banger/positions-db";
import type { HorizonPlay } from "../horizon-plays";
import { calendarDte } from "../horizon-fanout";
import { HORIZONS } from "../horizons";
import { subLaneForDte } from "./taxonomy";

const BANGER_SIGNAL = "BANGER";
const LIVE_BANGER = new Set(["OPEN", "PARTIAL"]);

function etYmd(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(now);
}

function livePnlPct(entry: number | null, mark: number | null): number | null {
  if (entry == null || mark == null || entry <= 0) return null;
  return Math.round(((mark / entry - 1) * 100) * 10) / 10;
}

/** Map one open banger ledger row → a SWING HorizonPlay in MANAGING/SCALING_OUT. */
export function horizonPlayFromBangerPosition(row: BangerPositionRow, now = new Date()): HorizonPlay | null {
  if (!LIVE_BANGER.has(row.status)) return null;
  const sessionYmd = etYmd(now);
  const dte = calendarDte(sessionYmd, row.contract_expiry);
  if (!Number.isFinite(dte) || dte < HORIZONS.SWING.dteMin || dte > HORIZONS.SWING.dteMax) return null;

  const entry = row.entry_premium;
  const mark = row.last_mark;
  const mid = mark ?? entry;
  const gainPct = row.discovery_gain != null ? Math.round(row.discovery_gain * 1000) / 10 : null;
  const liveStatus = row.status === "PARTIAL" || row.scaled_already ? "TRIM" : "OPEN";
  const manageAction =
    row.scale_out_action === "TRIM" || row.scaled_already
      ? "TAKE_PARTIAL"
      : row.scale_out_action === "EXIT"
        ? "EXIT"
        : "HOLD";

  return {
    ticker: row.ticker.toUpperCase(),
    direction: "LONG",
    horizon: "SWING",
    score: gainPct != null ? Math.min(99, Math.max(60, 60 + Math.round(gainPct / 2))) : HORIZONS.SWING.scoreFloor,
    status: "COMMIT",
    scoreFloor: HORIZONS.SWING.scoreFloor,
    reason: `Banger breakout +${gainPct ?? "—"}% · ${row.contract_strike}C ${row.contract_expiry}`,
    contract: {
      strike: row.contract_strike,
      expiry: row.contract_expiry,
      right: "C",
      dte,
      mid,
      delta: null,
      gamma: null,
      theta: null,
      vega: null,
      iv: null,
      bid: null,
      ask: null,
      openInterest: null,
    },
    archetype: "BREAKOUT",
    subLane: subLaneForDte(dte),
    setupState: "TRIGGERED",
    entryStatus: "AT_TRIGGER",
    serving: row.scaled_already ? "SCALING_OUT" : "MANAGING",
    firstSeenAt: row.first_seen_at,
    committedAt: row.committed_at ?? row.first_seen_at,
    entryPremium: entry,
    livePnlPct: livePnlPct(entry, mark),
    peakPremium: row.peak_premium,
    signalKinds: [BANGER_SIGNAL],
    bucketGraduated: false,
    liveStatus,
    manageAction,
    thesisLevel: "intact",
    thesisNote: row.scale_out_reason ?? "Engine B scale-out — whole-market breakout",
    regime: "BREAKOUT · BANGER",
    factors: gainPct != null ? [{ label: "Discovery gain", points: Math.round(gainPct) }] : [],
  };
}

/**
 * Merge banger open-book rows into an existing SWING play list. Banger rows win on ticker collision when
 * they carry live capital (an open banger position supersedes a pre-entry WATCH on the same symbol).
 */
export function mergeBangerPositionsIntoSwingPlays(
  plays: readonly HorizonPlay[],
  bangerRows: readonly BangerPositionRow[],
  now = new Date(),
): HorizonPlay[] {
  const bangerPlays = bangerRows
    .map((r) => horizonPlayFromBangerPosition(r, now))
    .filter((p): p is HorizonPlay => p != null);
  if (bangerPlays.length === 0) return [...plays];

  const bangerTickers = new Set(bangerPlays.map((p) => p.ticker.toUpperCase()));
  const withoutCollision = plays.filter((p) => !bangerTickers.has(p.ticker.toUpperCase()));
  return [...withoutCollision, ...bangerPlays];
}
