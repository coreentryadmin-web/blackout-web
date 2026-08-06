// src/lib/swing/live-plays.ts — map OPEN swing ledger rows onto HorizonPlay carriers for the live sections.
//
// WHY: the seven-section desk needs MANAGING / SCALING_OUT / EXITING populated from real positions, not
// only pre-entry discovery plays. This pure mapper stamps liveStatus / manageAction / thesisLevel from
// the ledger row (+ optional live spot for structural-break detection) so `sectionForSwingPlay` can route.
//
// CACHE-READER SAFE: callers supply rows + spots already loaded (cron-warmed Redis / DB). No provider IO.
// NULL-HONEST: missing contract fields → skipped (never a fabricated play).

import type { HorizonPlay } from "../horizon-plays";
import type { ChainContract, PlayDirection } from "../horizon-fanout";
import { calendarDte } from "../horizon-fanout";
import type { SwingPositionRow } from "../db";
import type { SwingArchetype, SwingSubLane } from "./taxonomy";
import type { SwingLiveStatus, SwingThesisLevel } from "./serving";
import type { SwingManageAction, SwingManageRung } from "./manage";
import { HORIZONS } from "../horizons";

const LIVE: ReadonlySet<string> = new Set(["OPEN", "HOLD", "TRIM"]);

function liveStatusOf(status: string): SwingLiveStatus | null {
  if (status === "TRIM") return "TRIM";
  if (status === "HOLD") return "HOLD";
  if (status === "OPEN") return "OPEN";
  return null;
}

function etYmd(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(now);
}

function livePnlPct(entry: number | null, mark: number | null): number | null {
  if (entry == null || mark == null || entry <= 0) return null;
  return Math.round(((mark / entry - 1) * 100) * 10) / 10;
}

/**
 * The live quote + greeks the active-refresh cron already fetched for a held contract, carried on the
 * latest manage snapshot's `event_json.quote` (stamped by manage-sync.planManageSync).
 *
 * WHY this exists (FINDINGS 2026-08-06, SEV-2): a committed swing row's contract was reconstructed from
 * LEDGER COLUMNS ONLY (strike/expiry/type/delta) — the ledger has no quote columns — so every live
 * position served `bid: null, ask: null, openInterest: 0` and no greek beyond the delta PINNED AT COMMIT,
 * while pre-entry discovery plays (whose contract comes straight off a chain fetch) carried a real
 * bid/ask/OI. That inverse split is what the desk saw. The member horizons route is a CACHE-READER (it
 * must not fan out to a provider per request), so the quote has to be CARRIED to it: the 15-min cron
 * already calls fetchOptionsUnifiedSnapshot for the mark and threw the rest of that snapshot away. It now
 * stamps the whole quote onto the append-only manage snapshot the route ALREADY reads
 * (fetchLatestSwingSnapshotEvents), so this mapper hydrates it with zero new IO and zero new schema.
 */
export interface SwingLiveQuote {
  bid: number | null;
  ask: number | null;
  openInterest: number | null;
  delta: number | null;
  gamma: number | null;
  theta: number | null;
  vega: number | null;
  iv: number | null;
  /** ISO instant the quote was sampled — staleness evidence for the desk (never used to fabricate). */
  asOf?: string | null;
}

const finOrNull = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

/**
 * Parse `event_json.quote` off a manage snapshot. Absent/malformed ⇒ null, so a snapshot written before
 * the cron stamped quotes degrades to the honest "no quote" shape instead of throwing or half-filling.
 */
export function liveQuoteFromEvent(
  manageEvent: Record<string, unknown> | null | undefined,
): SwingLiveQuote | null {
  const raw = manageEvent && typeof manageEvent === "object" ? manageEvent.quote : null;
  if (!raw || typeof raw !== "object") return null;
  const q = raw as Record<string, unknown>;
  const quote: SwingLiveQuote = {
    bid: finOrNull(q.bid),
    ask: finOrNull(q.ask),
    openInterest: finOrNull(q.openInterest),
    delta: finOrNull(q.delta),
    gamma: finOrNull(q.gamma),
    theta: finOrNull(q.theta),
    vega: finOrNull(q.vega),
    iv: finOrNull(q.iv),
    asOf: typeof q.asOf === "string" ? q.asOf : null,
  };
  // A quote blob with nothing usable in it is the same as no quote — don't dress up an empty object.
  const anyValue = [
    quote.bid,
    quote.ask,
    quote.openInterest,
    quote.delta,
    quote.gamma,
    quote.theta,
    quote.vega,
    quote.iv,
  ].some((v) => v != null);
  return anyValue ? quote : null;
}

function contractFromRow(row: SwingPositionRow, quote?: SwingLiveQuote | null): ChainContract | null {
  const expiry = row.contract_expiry;
  const strike = row.contract_strike;
  if (!expiry || strike == null || !Number.isFinite(strike)) return null;
  const right = row.contract_type === "put" ? "P" : "C";
  const dte = calendarDte(etYmd(), expiry.slice(0, 10));
  const mark = row.last_mark;
  return {
    ticker: row.ticker.toUpperCase(),
    right,
    expiry,
    dte,
    strike,
    // LIVE delta wins over row.contract_delta: the latter is PINNED AT COMMIT (the delta the ranker
    // selected on), so serving it as the position's delta today ages silently. Fall back to the pinned
    // value only when there is no live quote at all — a commit-pinned delta beats no delta.
    delta: quote?.delta ?? row.contract_delta,
    // ChainContract types openInterest as a plain `number` (the 0DTE fan-out does arithmetic on it), so
    // it cannot carry "unknown"; 0 is the floor that fan-out already reads as "no OI", and no swing
    // surface renders OI, so an absent quote never displays a confident zero to a member. When the
    // quote HAS open interest we serve the real number instead of the old hardcoded 0.
    openInterest: quote?.openInterest ?? 0,
    bid: quote?.bid ?? null,
    ask: quote?.ask ?? null,
    // FINDINGS 2026-08-06 (SEV-1): this was `mark ?? entry`, which LAUNDERED "no live mark yet" into
    // "the mark is exactly the entry". Downstream that is indistinguishable from a real flat quote:
    // adapters.ts terminalPlayFromHorizon puts it on TerminalPlay.mark, markDollarPnl computes
    // mark - entry = 0, and the hero renders a confident "+$0.00" on a live-money position. Serving the
    // honest null instead makes markDollarPnl return null and the EXISTING TerminalPremiumPanels fallback
    // render "—" (unknown), which is what livePnlPct below has always (correctly) reported for a null mark.
    // NEVER substitute entry for an absent mark — a fabricated mark is worse than a missing one.
    mid: mark,
    // Greeks ride the live quote only. Explicit nulls (not omitted keys) so an absent quote reads as
    // KNOWN-MISSING at every consumer — the deck's greek cells already render "—" for null.
    gamma: quote?.gamma ?? null,
    theta: quote?.theta ?? null,
    vega: quote?.vega ?? null,
    iv: quote?.iv ?? null,
  };
}

/**
 * Detect a structural thesis break from live spot vs pinned invalidation. Pure — used to stamp EXITING
 * without re-running the full manager on the member request path.
 */
export function structuralBreakFromSpot(
  direction: "long" | "short",
  spot: number | null | undefined,
  invalidationPx: number | null | undefined,
): boolean {
  if (spot == null || !Number.isFinite(spot) || invalidationPx == null || !Number.isFinite(invalidationPx)) {
    return false;
  }
  return direction === "long" ? spot <= invalidationPx : spot >= invalidationPx;
}

/**
 * Overlay authoritative manage observables from the latest append-only snapshot event_json
 * (written by manage-sync on each active-refresh tick). Spot-based structural break remains
 * the fallback when no snapshot exists yet.
 */
export function manageObservablesFromEvent(
  manageEvent: Record<string, unknown> | null | undefined,
  spotFallback: { manageAction?: SwingManageAction; thesisLevel?: SwingThesisLevel },
): { manageAction?: SwingManageAction; thesisLevel?: SwingThesisLevel } {
  if (!manageEvent || typeof manageEvent !== "object") return spotFallback;

  let manageAction = spotFallback.manageAction;
  let thesisLevel = spotFallback.thesisLevel ?? "intact";

  const action = manageEvent.action;
  if (action === "EXIT" || action === "STOP_OUT" || action === "TAKE_PARTIAL" || action === "EXIT_RUNNER") {
    manageAction = action;
  }

  const rung = manageEvent.rung as SwingManageRung | undefined;
  const thesisState = typeof manageEvent.thesis_state === "string" ? manageEvent.thesis_state : null;

  if (
    thesisState === "BROKEN" ||
    rung === "structural_stop" ||
    rung === "thesis_stop"
  ) {
    manageAction = manageAction === "STOP_OUT" ? "STOP_OUT" : "EXIT";
    thesisLevel = "break";
  } else if (thesisState === "STOPPED" || rung === "premium_stop") {
    manageAction = "STOP_OUT";
  } else if (thesisState === "EXPIRY_RISK" || rung === "expiry_risk") {
    manageAction = manageAction ?? "EXIT";
  }

  return { manageAction, thesisLevel };
}

/**
 * Map one open ledger row (+ optional spot + latest manage snapshot) to a HorizonPlay for the live sections. Returns null when the
 * row is not a live status or lacks a reconstructible contract.
 */
export function livePlayFromSwingPosition(
  row: SwingPositionRow,
  spot?: number | null,
  manageEvent?: Record<string, unknown> | null,
): HorizonPlay | null {
  if (!LIVE.has(row.status)) return null;
  // The same manage snapshot that carries the manage observables also carries the tick's option quote.
  const contract = contractFromRow(row, liveQuoteFromEvent(manageEvent));
  if (!contract) return null;
  const direction: PlayDirection = row.direction === "short" ? "SHORT" : "LONG";
  const liveStatus = liveStatusOf(row.status)!;
  const dirLc = row.direction === "short" ? "short" : "long";
  const broken = structuralBreakFromSpot(dirLc, spot, row.thesis_invalidation_px);

  const spotObs = manageObservablesFromEvent(null, {
    manageAction: broken ? "EXIT" : liveStatus === "TRIM" ? "TAKE_PARTIAL" : undefined,
    thesisLevel: broken ? "break" : "intact",
  });
  const { manageAction, thesisLevel } = manageObservablesFromEvent(manageEvent, spotObs);

  const score =
    row.feature_vector && typeof row.feature_vector.evidence_score === "number"
      ? (row.feature_vector.evidence_score as number)
      : 0;

  const entry = row.entry_premium;
  const mark = row.last_mark;

  return {
    ticker: row.ticker.toUpperCase(),
    direction,
    horizon: "SWING",
    score,
    status: "COMMIT", // live capital is committed — back-compat committed[] view
    contract,
    scoreFloor: HORIZONS.SWING.scoreFloor,
    reason: `live ${row.status.toLowerCase()} — ${row.archetype ?? "swing"} thesis`,
    archetype: (row.archetype as SwingArchetype | null) ?? undefined,
    subLane: (row.sub_lane as SwingSubLane | null) ?? undefined,
    liveStatus,
    manageAction,
    thesisLevel,
    firstSeenAt: row.first_seen_at ?? undefined,
    committedAt: row.committed_at ?? undefined,
    entryPremium: entry,
    livePnlPct: livePnlPct(entry, mark),
    peakPremium: row.peak_premium,
    troughPremium: row.trough_premium,
  };
}

/** Map a book of open rows → live HorizonPlays. Spots keyed uppercased; manage events keyed by position id. */
export function livePlaysFromOpenPositions(
  rows: readonly SwingPositionRow[],
  spotsByTicker?: Record<string, number> | Map<string, number>,
  manageEventsByPositionId?: Map<number, Record<string, unknown>>,
): HorizonPlay[] {
  const spotOf = (ticker: string): number | null => {
    const key = ticker.toUpperCase();
    if (!spotsByTicker) return null;
    if (spotsByTicker instanceof Map) {
      const v = spotsByTicker.get(key);
      return v != null && Number.isFinite(v) ? v : null;
    }
    const v = spotsByTicker[key];
    return v != null && Number.isFinite(v) ? v : null;
  };
  const out: HorizonPlay[] = [];
  for (const row of rows) {
    const play = livePlayFromSwingPosition(
      row,
      spotOf(row.ticker),
      manageEventsByPositionId?.get(row.id) ?? null,
    );
    if (play) out.push(play);
  }
  return out;
}
