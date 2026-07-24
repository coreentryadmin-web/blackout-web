// src/lib/swing/event-trigger.ts — live-event routing for the swing lane (PR-13). ADVANCE-CANDIDATE, NEVER COMMIT.
//
// WHY (docs/audit/SWING-ENGINE.md §4 PR-13): the swing engine's primary cadence is the phase-anchored cron
// (scan-cadence.ts). But a genuinely large, DIRECTIONAL, multi-day-dated print on the live UW tape is early
// evidence that a thesis is building — waiting for the next scheduled scan to notice it wastes signal. This
// module lets such a print ADVANCE the cross-session accumulation memory in real time (one observation into
// `swing_candidate_accumulation`, exactly what a scheduled scan does), so a name accretes persistence sooner.
//
// THE INVARIANT (why this is safe to run live): advancing accumulation is NOT committing. `upsertSwingAccum`
// only accretes an observation; a candidate still cannot reach the WATCH rail until it has persisted across
// ≥2 DISTINCT session days (accumulation-store's persistence gate), and NOTHING here ever inserts a position
// or sizes risk. So a live event can only make a name accrete faster — never open a trade. This mirrors the
// 0DTE scan-trigger (react to the tape, not just the clock) but for a MEMORY write, not a board re-scan.
//
// THROTTLED (scan-trigger pattern): the tape is bursty, so a per-(ticker,direction) debouncer caps how often
// any one name advances — a wall of prints on NVDA calls advances NVDA-LONG at most once per interval, never
// once per print. PURE pieces (`isMaterialSwingFlow`, `swingDirectionOf`) + a thin injected-accessor shell so
// the predicate boundaries and the never-commit routing are unit-testable without a live WS or DB.

import type { PlayDirection } from "../horizon-fanout";
import { dteOf } from "../zerodte/scan-trigger";
import type { SwingAccumAccessors } from "./accumulation-store";
import { observeSwingCandidate } from "./accumulation-store";

/** Min premium for a single live print to advance the swing memory. Higher than discovery's per-alert 250k
 *  floor: one live print should be genuinely large to move the memory out-of-band; smaller flow still counts,
 *  it just waits for the scheduled scan's aggregated multi-day read. Provisional (not a graduated edge). */
export const SWING_EVENT_MIN_PREMIUM = 750_000;
/** The swing contract window is 2–30 DTE (taxonomy sub-lanes); a print outside it is a 0DTE lottery or a LEAP,
 *  not a swing thesis. Inclusive bounds. */
export const SWING_EVENT_MIN_DTE = 2;
export const SWING_EVENT_MAX_DTE = 30;
/** At most one advance per (ticker,direction) per this interval — well above the write cost, spam-proof. */
export const SWING_EVENT_MIN_INTERVAL_MS = 60_000;
/** Provenance tag written into `phases_seen` so a live-tape advance is distinguishable from a scheduled scan. */
export const SWING_LIVE_FLOW_PHASE = "LIVE_FLOW";

/** The subset of a parsed flow alert the swing materiality test needs (matches MarketFlowAlert fields). */
export type MaterialSwingFlowInput = {
  premium: number;
  /** "CALL" | "PUT" | "UNKNOWN" (parseUwFlowAlert never defaults a missing side — UNKNOWN is non-directional). */
  option_type: string;
  /** YYYY-MM-DD contract expiry. */
  expiry: string;
  ticker?: string;
};

/** CALL → LONG, PUT → SHORT, anything else (UNKNOWN/unparseable) → null (non-directional, never guessed). */
export function swingDirectionOf(optionType: string): PlayDirection | null {
  const t = String(optionType ?? "").toUpperCase();
  if (t === "CALL" || t.startsWith("C")) return "LONG";
  if (t === "PUT" || t.startsWith("P")) return "SHORT";
  return null;
}

/**
 * Is this live print material enough to advance the swing accumulation memory out-of-band? A big (≥ $750k),
 * DIRECTIONAL (call/put, not unknown), SWING-DATED (2–30 DTE) print — i.e. real multi-day positioning on a
 * contract the swing lane actually trades. Conservative on purpose: only genuinely large directional swing
 * flow advances the memory early; everything else waits for the scheduled scan's aggregated read.
 */
export function isMaterialSwingFlow(flow: MaterialSwingFlowInput, nowMs: number): boolean {
  if (!(flow.premium >= SWING_EVENT_MIN_PREMIUM)) return false;
  if (swingDirectionOf(flow.option_type) == null) return false;
  const dte = dteOf(flow.expiry, nowMs);
  return dte != null && dte >= SWING_EVENT_MIN_DTE && dte <= SWING_EVENT_MAX_DTE;
}

/**
 * Per-key throttle (scan-trigger's debouncer, keyed). `maybeFire` runs the callback and returns true iff
 * enough time has passed since THIS key last fired; otherwise a no-op. Keying on `${ticker}|${direction}`
 * lets many distinct names advance in the same tick while a burst on ONE name is collapsed to one advance.
 */
export function createSwingFlowDebouncer(minIntervalMs: number = SWING_EVENT_MIN_INTERVAL_MS): {
  maybeFire: (key: string, nowMs: number, fire: () => void) => boolean;
} {
  const lastFiredMs = new Map<string, number>();
  return {
    maybeFire(key, nowMs, fire) {
      const last = lastFiredMs.get(key);
      if (last != null && nowMs - last < minIntervalMs) return false;
      lastFiredMs.set(key, nowMs);
      fire();
      return true;
    },
  };
}

/** What the swing accumulation accessor surface the router needs — a subset of the PR-11 store accessors. */
export interface SwingFlowRouteDeps {
  accum: SwingAccumAccessors;
  /** ET session day (YYYY-MM-DD) the advance is attributed to — the distinct-day persistence key. */
  sessionDay: string;
}

export interface SwingFlowRouteResult {
  advanced: boolean;
  ticker: string | null;
  direction: PlayDirection | null;
  reason: string;
}

/**
 * Route ONE material live print into the accumulation memory — ADVANCE ONLY. Records a single observation for
 * (ticker, direction) via `observeSwingCandidate`; there is deliberately NO commit path here — this shell
 * cannot reach `insertSwingPosition`, so a live event can never open a trade, only accrete persistence. Returns
 * advanced:false (with a reason) for a non-material or non-directional/untickered print — never throws.
 */
export async function advanceSwingAccumulationFromFlow(
  flow: MaterialSwingFlowInput,
  deps: SwingFlowRouteDeps,
  nowMs: number,
): Promise<SwingFlowRouteResult> {
  if (!isMaterialSwingFlow(flow, nowMs)) {
    return { advanced: false, ticker: flow.ticker ?? null, direction: null, reason: "not a material swing flow" };
  }
  const ticker = String(flow.ticker ?? "").toUpperCase();
  const direction = swingDirectionOf(flow.option_type);
  if (!ticker || direction == null) {
    return { advanced: false, ticker: ticker || null, direction, reason: "no ticker / non-directional — nothing to advance" };
  }
  // ADVANCE-ONLY: accrete one observation. Never commits (no insertSwingPosition reachable from here).
  await observeSwingCandidate(deps.accum, {
    ticker,
    direction,
    sessionDay: deps.sessionDay,
    phase: SWING_LIVE_FLOW_PHASE,
  });
  return { advanced: true, ticker, direction, reason: "advanced accumulation (never committed)" };
}
