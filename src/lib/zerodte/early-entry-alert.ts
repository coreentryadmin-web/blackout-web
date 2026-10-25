// EARLY-ENTRY alert assembly — the final shape shown to a member, and the operator's explicit
// NO TRADE sentinel when nothing qualifies.
//
// OPERATOR'S OWN WORDS: "Show the exact contract, bid/ask, quote timestamp, entry trigger,
// underlying targets, invalidation, and why the opportunity is developing NOW... Return NO TRADE
// when nothing meets the requirements, and never present a huge run as guaranteed."
//
// This module does no detection/selection/pricing itself — it only COMBINES the already-real
// outputs of early-entry-state.ts (WATCH/ENTRY/EXPIRED/INVALIDATED/NO_SETUP),
// early-entry-contract-select.ts (the real chain screen), and early-entry-value-scenarios.ts
// (the labeled estimate grid) into one of three user-facing shapes: a NO_TRADE sentinel (with an
// honest reason), a WATCH (developing, not yet actionable), or an ENTRY alert (a real, selected
// contract). It never upgrades a WATCH into a trade recommendation, and it never fabricates a
// target/level this session's real classification/selection didn't already compute.

import type { SetupClassification } from "./early-entry-state";
import type { EarlyEntryCandidate, EarlyEntryRejection } from "./early-entry-contract-select";
import { estimateContractValueScenarios, type ValueScenarios } from "./early-entry-value-scenarios";

export type EarlyEntryNoTrade = {
  state: "NO_TRADE";
  ticker: string;
  reason:
    | "no_developing_setup"
    | "setup_invalidated"
    | "setup_expired"
    | "entry_not_yet_triggered"
    | "no_qualifying_contract";
};

export type EarlyEntryWatchAlert = {
  state: "WATCH";
  ticker: string;
  direction: "long" | "short";
  level: number;
  invalidation_level: number;
  trigger_price: number;
  watch_detected_at_ms: number;
  watch_expires_at_ms: number;
  why_developing: string;
};

export type EarlyEntryContractView = {
  strike: number;
  side: "call" | "put";
  bid: number | null;
  ask: number;
  /** Epoch ms of the quote used to price this contract, when the provider supplied one — null
   *  means genuinely unknown, never guessed fresh. */
  quote_as_of_ms: number | null;
  oi: number | null;
  iv: number | null;
};

export type EarlyEntryTarget = { label: string; price: number };

export type EarlyEntryAlert = {
  state: "ENTRY";
  ticker: string;
  direction: "long" | "short";
  level: number;
  invalidation_level: number;
  trigger_price: number;
  entry_triggered_at_ms: number;
  underlying_spot_now: number;
  underlying_targets: EarlyEntryTarget[];
  contract: EarlyEntryContractView;
  /** Other real strikes considered on this signal and why each was rejected — transparency, not
   *  a second opinion the member has to take on faith. */
  rejected_alternatives: EarlyEntryRejection[];
  why_now: string;
  value_scenarios: ValueScenarios;
};

export type EarlyEntryResult = EarlyEntryNoTrade | EarlyEntryWatchAlert | EarlyEntryAlert;

function narrateDeveloping(classification: Pick<SetupClassification, "direction" | "level" | "pressure">): string {
  const p = classification.pressure;
  const sideWord = classification.direction === "long" ? "resistance" : "support";
  const tests = p?.level_tests ?? 0;
  const rvol = p?.rvol_ratio != null ? `${p.rvol_ratio.toFixed(2)}x` : "an unconfirmed";
  return (
    `Coiling just ${classification.direction === "long" ? "under" : "above"} ${sideWord} at ` +
    `${classification.level} — tested ${tests}x without breaking, on ${rvol} relative volume.`
  );
}

function narrateEntry(
  classification: Pick<SetupClassification, "direction" | "level" | "trigger_price" | "pressure">
): string {
  const p = classification.pressure;
  const bias = p?.order_flow_bias != null ? (p.order_flow_bias > 0 ? "upward" : p.order_flow_bias < 0 ? "downward" : "flat") : null;
  const biasPhrase = bias ? `, tape leaning ${bias}` : "";
  return (
    `Broke ${classification.direction === "long" ? "above" : "below"} the ${classification.level} level ` +
    `it had tested ${p?.level_tests ?? 0}x, confirmed by relative volume${biasPhrase} -- the coil just resolved.`
  );
}

/**
 * Pure. Assembles the final member-facing result from the real classification + real contract
 * selection. `minutesRemaining`/`spotNow` drive the value-scenario grid; `candidates`/
 * `rejections` come straight from `selectEarlyEntryContract`'s own output for this same signal.
 */
export function buildEarlyEntryAlert(input: {
  ticker: string;
  classification: SetupClassification;
  candidates: EarlyEntryCandidate[];
  rejections: EarlyEntryRejection[];
  spotNow: number;
  minutesRemaining: number;
  /** Per-(strike,side) quote timestamp lookup, when the caller has one -- optional, never
   *  fabricated when absent. */
  quoteAsOfMsByContract?: (strike: number, side: "call" | "put") => number | null;
}): EarlyEntryResult {
  const { ticker, classification } = input;

  if (classification.state === "NO_SETUP") return { state: "NO_TRADE", ticker, reason: "no_developing_setup" };
  if (classification.state === "INVALIDATED") return { state: "NO_TRADE", ticker, reason: "setup_invalidated" };
  if (classification.state === "EXPIRED") return { state: "NO_TRADE", ticker, reason: "setup_expired" };

  if (classification.state === "WATCH") {
    return {
      state: "WATCH",
      ticker,
      direction: classification.direction,
      level: classification.level!,
      invalidation_level: classification.invalidation_level!,
      trigger_price: classification.trigger_price!,
      watch_detected_at_ms: classification.watch_detected_at_ms!,
      watch_expires_at_ms: classification.watch_expires_at_ms!,
      why_developing: narrateDeveloping(classification),
    };
  }

  // state === "ENTRY"
  if (input.candidates.length === 0) return { state: "NO_TRADE", ticker, reason: "no_qualifying_contract" };

  const top = input.candidates[0]!;
  const level = classification.level!;
  const em = input.candidates[0]!.expected_move_pct; // % of spot, from the SAME reachability math
  const targets: EarlyEntryTarget[] = [
    { label: "the level it broke", price: level },
  ];
  if (em != null) {
    const sign = classification.direction === "long" ? 1 : -1;
    targets.push({
      label: "+1x expected move",
      price: Math.round((input.spotNow * (1 + sign * (em / 100))) * 100) / 100,
    });
    targets.push({
      label: "+2x expected move",
      price: Math.round((input.spotNow * (1 + sign * (2 * em / 100))) * 100) / 100,
    });
  }

  const valueScenarios = estimateContractValueScenarios({
    spot: input.spotNow,
    strike: top.strike,
    side: top.side,
    iv: top.iv,
    minutesRemaining: input.minutesRemaining,
  });

  return {
    state: "ENTRY",
    ticker,
    direction: classification.direction,
    level,
    invalidation_level: classification.invalidation_level!,
    trigger_price: classification.trigger_price!,
    entry_triggered_at_ms: classification.entry_triggered_at_ms!,
    underlying_spot_now: input.spotNow,
    underlying_targets: targets,
    contract: {
      strike: top.strike,
      side: top.side,
      bid: top.bid,
      ask: top.ask,
      quote_as_of_ms: input.quoteAsOfMsByContract?.(top.strike, top.side) ?? null,
      oi: top.oi,
      iv: top.iv,
    },
    rejected_alternatives: input.rejections,
    why_now: narrateEntry(classification),
    value_scenarios: valueScenarios,
  };
}
