/**
 * 0DTE → unified HorizonPlay adapter (remodel: "complete the 0DTE system").
 *
 * The three-board Night Hawk (0DTE / Swing / LEAPS) renders one uniform shape — HorizonPlay. The Swing and
 * LEAPS lanes come from the generic scorer path (horizon-candidate.ts → produceHorizonPlays). The ZERO_DTE
 * lane does NOT: it already has a mature, battle-tested engine (deriveZeroDteSetups → EnrichedZeroDteSetup,
 * with its own hard-gate stack, Cortex layer, dossier scoring, iron-condor geometry, and graded ledger).
 * Throwing that away to re-score 0DTE through the generic lens would be a downgrade.
 *
 * So the ZERO_DTE lane is powered by the PROVEN engine and this adapter maps its rich output into the
 * uniform HorizonPlay the board consumes — the engine stays the source of truth for 0DTE; the adapter is
 * pure translation. COMMIT/WATCH is taken from the engine's REAL decision (its gate verdict / persisted
 * live status), NOT re-thresholded, so a play the hard gates blocked shows as WATCH here exactly as it does
 * on the 0DTE Command board.
 *
 * PURE & deterministic — no IO. Type-only imports of the engine types keep this out of board.ts's provider
 * load graph.
 */

import { HORIZONS } from "../horizons";
import type { HorizonPlay, PlayStatus } from "../horizon-plays";
import type { ChainContract, PlayDirection } from "../horizon-fanout";
import type { EnrichedZeroDteSetup } from "./board";

const ZERO_DTE_FLOOR = HORIZONS.ZERO_DTE.scoreFloor;

/** Persisted live-lifecycle states that mean the play is already a committed, working position. */
const COMMITTED_STATUSES = new Set(["OPEN", "HOLD", "TRIM"]);

const midOf = (bid: number | null, ask: number | null): number | null =>
  bid != null && ask != null && Number.isFinite(bid) && Number.isFinite(ask) && ask >= bid && bid >= 0
    ? (bid + ask) / 2
    : null;

/**
 * The engine's REAL commit decision, in priority order:
 *   1. a persisted live status of OPEN/HOLD/TRIM — it's already a working committed play;
 *   2. else the fresh-find hard-gate verdict (gate.verdict === "COMMIT") — the engine's own gate stack;
 *   3. else (no gate context — an already-seen refresh ticker whose gate wasn't re-run) fall back to the
 *      lane floor on the committed score.
 * This mirrors the 0DTE Command board exactly — a gate-blocked setup is WATCH, never silently promoted.
 */
function zeroDteCommitStatus(setup: EnrichedZeroDteSetup, persistedStatus?: string | null): PlayStatus {
  if (persistedStatus && COMMITTED_STATUSES.has(persistedStatus.toUpperCase())) return "COMMIT";
  if (setup.gate) return setup.gate.verdict === "COMMIT" ? "COMMIT" : "WATCH";
  return setup.score >= ZERO_DTE_FLOOR ? "COMMIT" : "WATCH";
}

/** Build the uniform ChainContract from the setup's top strike + its live plan quote (when present). */
function contractFor(setup: EnrichedZeroDteSetup): ChainContract | null {
  if (setup.top_strike == null || !Number.isFinite(setup.top_strike)) return null; // no strike → nothing to render
  const bid = setup.plan?.bid ?? null;
  const ask = setup.plan?.ask ?? null;
  return {
    ticker: setup.ticker.toUpperCase(),
    right: setup.direction === "long" ? "C" : "P",
    expiry: setup.expiry,
    dte: Math.max(0, setup.dte),
    strike: setup.top_strike,
    // Delta/OI aren't tracked at the setup layer — the engine's OWN liquidity gate already vetted the plan
    // (plan.illiquid / spread_pct), so a 0 here means "not surfaced at this layer", not "illiquid".
    delta: null,
    openInterest: 0,
    bid,
    ask,
    mid: setup.plan?.mark ?? midOf(bid, ask),
  };
}

/** One-line human summary mirroring the 0DTE card. */
function reasonFor(setup: EnrichedZeroDteSetup): string {
  const side = setup.direction === "long" ? "call" : "put";
  const strike = setup.top_strike != null ? `${setup.top_strike}${setup.direction === "long" ? "C" : "P"}` : side;
  const entry = setup.plan?.entry_max != null ? ` · entry ≤ $${setup.plan.entry_max.toFixed(2)}` : "";
  return `0DTE ${strike}${entry}`;
}

/**
 * Map ONE enriched 0DTE setup to a HorizonPlay, or null when it can't be expressed as a contract (no top
 * strike). `persistedStatus` is the ledger's live-lifecycle status (OPEN/HOLD/TRIM/CLOSED) when known — it
 * makes an already-committed working play read as COMMIT even after its fresh-find gate context has aged out.
 */
export function zeroDteSetupToHorizonPlay(
  setup: EnrichedZeroDteSetup,
  persistedStatus?: string | null,
): HorizonPlay | null {
  const contract = contractFor(setup);
  if (!contract) return null;
  const direction: PlayDirection = setup.direction === "long" ? "LONG" : "SHORT";
  return {
    ticker: setup.ticker.toUpperCase(),
    direction,
    horizon: "ZERO_DTE",
    score: setup.score,
    status: zeroDteCommitStatus(setup, persistedStatus),
    contract,
    scoreFloor: ZERO_DTE_FLOOR,
    reason: reasonFor(setup),
  };
}

/**
 * Map a whole scan's worth of enriched 0DTE setups into the ZERO_DTE lane's HorizonPlays, sorted by score
 * (desc) to match every other lane. Setups with no expressible contract are dropped (never a hollow play).
 * `statusByTicker` supplies persisted live statuses keyed by UPPERCASE ticker, when the caller has the ledger.
 */
export function zeroDteSetupsToHorizonPlays(
  setups: EnrichedZeroDteSetup[],
  statusByTicker?: Map<string, string | null>,
): HorizonPlay[] {
  const plays: HorizonPlay[] = [];
  for (const s of setups) {
    const play = zeroDteSetupToHorizonPlay(s, statusByTicker?.get(s.ticker.toUpperCase()));
    if (play) plays.push(play);
  }
  return plays.sort((a, b) => b.score - a.score);
}
