// Fold Engine B (Banger) open positions into the Swing Command lane — one ledger, one desk.
//
// Bangers were a parallel whole-market breakout screen with its own board UI; members never got a unified
// entry/exit experience. Swing Command absorbs OPEN/PARTIAL banger_positions as MANAGING plays with a
// BANGER origin badge. Pre-entry banger discovery continues via the banger-discovery cron but surfaces
// here instead of a separate Night Hawk tab.
//
// DTE admission for an OPEN LEDGER ROW is deliberately NOT the same gate as pre-entry discovery
// admission (HORIZONS.SWING.dteMin=5, kept strictly in sync with the 0DTE ceiling — see horizons.ts —
// to avoid the dual-admission bug from 2026-08-06). That boundary answers "should a NEW candidate be
// admitted into Swing's discovery/commit lane"; it says nothing about whether an ALREADY-OPEN banger
// position, entered when it legitimately had 5+ DTE, should keep being displayed once it ages down
// past that floor while still running. Nothing else reads banger_positions once a row leaves this
// merge (the 0DTE board has no banger awareness), so applying the discovery floor here made a real
// open position with real member capital simply vanish from every view for its final days before
// expiry. horizonPlayFromBangerPosition therefore only floors at dte>=0 (contract not yet expired);
// horizonPlayFromBangerWatch (a genuine NEW pre-entry admission) keeps the discovery-side floor.

import type { BangerPositionRow } from "../banger/positions-db";
import type { HorizonPlay } from "../horizon-plays";
import { calendarDte } from "../horizon-fanout";
import { HORIZONS } from "../horizons";
import { subLaneForDte } from "./taxonomy";
import type { BangerMover } from "../banger/discovery";

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
  // Floor at 0 (not-yet-expired), NOT HORIZONS.SWING.dteMin — see the header note: this is display
  // continuity for an already-open position, not a new discovery admission.
  if (!Number.isFinite(dte) || dte < 0 || dte > HORIZONS.SWING.dteMax) return null;
  const closingSoon = dte < HORIZONS.SWING.dteMin;

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
    reason: `Banger breakout +${gainPct ?? "—"}% · ${row.contract_strike}C ${row.contract_expiry}${closingSoon ? " · closing soon" : ""}`,
    contract: {
      ticker: row.contract_occ,
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
      openInterest: 0,
    },
    archetype: "BREAKOUT",
    subLane: subLaneForDte(dte) ?? undefined,
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

/** Pre-entry banger screen → WATCH row (no ledger commit). */
export function horizonPlayFromBangerWatch(
  mover: BangerMover,
  pick: {
    strike: number;
    expiry: string;
    occ: string;
    entryPremium: number;
    bid?: number | null;
    ask?: number | null;
  },
  sessionDay: string,
): HorizonPlay | null {
  const dte = calendarDte(sessionDay, pick.expiry);
  if (!Number.isFinite(dte) || dte < HORIZONS.SWING.dteMin || dte > HORIZONS.SWING.dteMax) return null;
  const gainPct = Math.round(mover.gain * 1000) / 10;
  return {
    ticker: mover.ticker.toUpperCase(),
    direction: "LONG",
    horizon: "SWING",
    score: Math.min(99, Math.max(58, 58 + Math.round(gainPct / 3))),
    status: "WATCH",
    scoreFloor: HORIZONS.SWING.scoreFloor,
    reason: `Banger screen +${gainPct}% · ${pick.strike}C ${pick.expiry}`,
    contract: {
      ticker: pick.occ,
      strike: pick.strike,
      expiry: pick.expiry,
      right: "C",
      dte,
      mid: pick.entryPremium,
      bid: pick.bid ?? null,
      ask: pick.ask ?? null,
      delta: null,
      gamma: null,
      theta: null,
      vega: null,
      iv: null,
      openInterest: 0,
    },
    archetype: "BREAKOUT",
    subLane: subLaneForDte(dte) ?? undefined,
    setupState: "TRIGGERED",
    entryStatus: "AT_TRIGGER",
    serving: "WATCH",
    signalKinds: [BANGER_SIGNAL],
    bucketGraduated: false,
    regime: "BREAKOUT · BANGER",
    factors: [{ label: "Discovery gain", points: Math.round(gainPct) }],
  };
}

/**
 * Merge banger open-book rows into an existing SWING play list. Banger rows win on ticker collision only
 * against pre-entry WATCH/SKIP rows — a live swing ledger OPEN/HOLD/TRIM position is canonical and must
 * not be evicted when Engine B also has capital on the same symbol.
 */
/** True when the row represents live swing ledger capital (not discovery-only pre-entry). */
export function isLiveManagingSwingPlay(play: HorizonPlay): boolean {
  const ls = play.liveStatus;
  if (ls === "OPEN" || ls === "HOLD" || ls === "TRIM") return true;
  return (
    play.serving === "MANAGING" || play.serving === "SCALING_OUT" || play.serving === "EXITING"
  );
}

/** Pre-entry discovery (WATCH or score-cleared COMMIT without ledger capital). */
export function isPreEntrySwingPlay(play: HorizonPlay): boolean {
  return !isLiveManagingSwingPlay(play);
}

export function mergeBangerPositionsIntoSwingPlays(
  plays: readonly HorizonPlay[],
  bangerRows: readonly BangerPositionRow[],
  now = new Date(),
): HorizonPlay[] {
  const bangerPlays = bangerRows
    .map((r) => horizonPlayFromBangerPosition(r, now))
    .filter((p): p is HorizonPlay => p != null);
  if (bangerPlays.length === 0) return [...plays];

  const managingTickers = new Set(
    plays
      .filter((p) => !isPreEntrySwingPlay(p))
      .map((p) => p.ticker.toUpperCase()),
  );
  const bangerToAdd = bangerPlays.filter((p) => !managingTickers.has(p.ticker.toUpperCase()));
  const bangerTickers = new Set(bangerToAdd.map((p) => p.ticker.toUpperCase()));
  const kept = plays.filter(
    (p) => !bangerTickers.has(p.ticker.toUpperCase()) || !isPreEntrySwingPlay(p),
  );
  return [...kept, ...bangerToAdd];
}
