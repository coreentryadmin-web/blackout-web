/**
 * MULTI-DAY FLOW ACCUMULATION → 0DTE board context (the "memory" the live loop never had).
 *
 * WHY THIS EXISTS: the 0DTE Command scanner discovers setups from a SEVEN-HOUR window of
 * current-session flow (`scanZeroDteBoard` → `fetchRecentFlows({ since_hours: 7, max_dte: 1 })`).
 * That is single-day amnesia: a name that has been getting hit on the SAME directional strike for
 * three days running looks identical to a one-off print. Real conviction is ACCUMULATION — stacked,
 * aggressive, persistent positioning across days. This module gives the loop that memory: it runs the
 * pure multi-day accumulation engine (`flowAccumulationByTicker`) over a multi-DAY flow window and
 * attaches, per setup, whether today's 0DTE direction is CONFIRMED by (or FIGHTS) the multi-day
 * stacked flow — plus the magnet strike being built.
 *
 * CALIBRATION-FIRST (the codebase's own discipline, ./calibration.ts): this ships as EVIDENCE only.
 * It attaches a read to every setup and surfaces it; it does NOT (yet) move the score or gate the
 * board. Whether "aligned with multi-day accumulation" actually predicts wins is a question for the
 * graded ledger to answer — once the evidence bucket is large enough and measurably better, the
 * alignment can graduate into a real scoring input exactly the way G-4/G-6 did. Never on vibes.
 *
 * PURE: the DB fetch stays in the caller (scan.ts); this module maps rows → alert rows, runs the
 * engine, and mutates the (already-built) setups with the context. Deterministic given (rows, nowMs).
 */

import {
  flowAccumulationByTicker,
  type FlowAlertRow,
  type FlowAccumulationSignal,
} from "@/features/nighthawk/lib/flow-accumulation";
import type { EnrichedZeroDteSetup } from "./board";

/** Multi-day lookback for the accumulation memory. 120h ≈ 5 trading-ish days — long enough to see a
 *  thesis build across a week, short enough to stay a CURRENT positioning read (the engine's own
 *  2.5-day recency half-life fades stale hits regardless). Exported so a backtest can sweep it. */
export const MULTI_DAY_FLOW_HOURS = 120;
/** Min per-alert premium for the multi-day window. Higher than the intraday scan's 150k: the memory
 *  layer wants real positioning, not every small print, and a wider time window means more rows. */
export const MULTI_DAY_MIN_PREMIUM = 250_000;
/** Row cap for the multi-day pull (premium-ordered). Bounds cost; 800 spans a normal week of the
 *  biggest directional prints without pulling the whole tape. */
export const MULTI_DAY_FLOW_LIMIT = 800;

/** The per-setup accumulation read attached to the board (evidence only; see file header). */
export type ZeroDteFlowAccumulation = {
  /** Multi-day directional lean of stacked flow for this underlying. */
  direction: "bull" | "bear" | "neutral";
  /** 0-100 accumulation conviction (premium × persistence × aggression, agreement-boosted). */
  strength: number;
  /** Distinct ET days the dominant (magnet) identity was hit — the persistence that separates a
   *  multi-day thesis from a lone print. */
  days: number;
  /** Net signed premium across the name's identities (+ bull / − bear), recency-weighted. */
  net_signed_premium: number;
  /** The strongest accumulated strike on the dominant side — the wall/magnet being built. */
  magnet_strike: number | null;
  magnet_side: "call" | "put" | null;
  /** Whether today's 0DTE setup direction AGREES with the multi-day accumulation. A long into a
   *  multi-day call build is confirmed; a long into a multi-day put build is fighting the tape.
   *  Null when the name has no directional multi-day read (neutral). */
  aligned: boolean | null;
};

/** The subset of a DB FlowRow the accumulation engine needs. */
export type MinimalFlowRow = {
  ticker: string;
  premium: number;
  option_type: string;
  strike: number;
  expiry: string;
  ask_pct?: number | null;
  alert_rule?: string | null;
  open_interest?: number | null;
  alerted_at?: string | null;
  event_at?: string | null;
};

function sideOf(optionType: string): "call" | "put" | null {
  const t = String(optionType ?? "").toLowerCase();
  if (t.startsWith("c")) return "call";
  if (t.startsWith("p")) return "put";
  return null;
}

/**
 * Map DB flow rows → the pure engine's FlowAlertRow[]. The DB tape carries `ask_pct` (share of the
 * print that traded at the ask) rather than a split premium, so we reconstruct the aggressor split:
 * ask-side = premium × ask_pct, bid-side = the remainder. When ask_pct is absent we leave BOTH null
 * so the engine uses its half-weight-by-side fallback instead of fabricating an aggressor.
 */
export function flowRowsToAlertRows(rows: MinimalFlowRow[]): FlowAlertRow[] {
  const out: FlowAlertRow[] = [];
  for (const r of rows) {
    const side = sideOf(r.option_type);
    const strike = Number(r.strike);
    const premium = Number(r.premium);
    const expiry = String(r.expiry ?? "").slice(0, 10);
    const createdAtMs = Date.parse(String(r.alerted_at || r.event_at || ""));
    if (!side || !(strike > 0) || !(premium > 0) || !expiry || !Number.isFinite(createdAtMs)) continue;

    let askSidePremium: number | null = null;
    let bidSidePremium: number | null = null;
    if (r.ask_pct != null && Number.isFinite(r.ask_pct)) {
      const frac = Math.max(0, Math.min(1, Number(r.ask_pct) / 100));
      askSidePremium = premium * frac;
      bidSidePremium = premium - askSidePremium;
    }

    out.push({
      ticker: String(r.ticker).toUpperCase(),
      strike,
      expiry,
      side,
      premium,
      askSidePremium,
      bidSidePremium,
      // The DB tape doesn't carry explicit sweep/opening/vol-OI flags; infer sweep from the alert
      // rule name when present (RepeatedHits/…Sweep). These are optional boosters — their absence
      // degrades gracefully to premium×persistence×aggressor, which is the core signal.
      sweep: /sweep/i.test(String(r.alert_rule ?? "")) || undefined,
      createdAtMs,
    });
  }
  return out;
}

/** Run the multi-day accumulation engine over DB flow rows → per-ticker signal. */
export function accumulationSignalsFromFlow(
  rows: MinimalFlowRow[],
  nowMs: number
): Map<string, FlowAccumulationSignal> {
  return flowAccumulationByTicker(flowRowsToAlertRows(rows), nowMs);
}

/** Whether a 0DTE setup's direction agrees with a multi-day accumulation direction. */
export function isAligned(
  setupDirection: "long" | "short",
  accDirection: "bull" | "bear" | "neutral"
): boolean | null {
  if (accDirection === "neutral") return null;
  return setupDirection === "long" ? accDirection === "bull" : accDirection === "bear";
}

/** Project a per-ticker accumulation signal onto a setup's evidence context. */
export function toFlowAccumulationContext(
  setupDirection: "long" | "short",
  sig: FlowAccumulationSignal
): ZeroDteFlowAccumulation {
  return {
    direction: sig.direction,
    strength: sig.strength,
    days: sig.magnet?.days ?? 0,
    net_signed_premium: sig.netSignedPremium,
    magnet_strike: sig.magnet?.strike ?? null,
    magnet_side: sig.magnet?.side ?? null,
    aligned: isAligned(setupDirection, sig.direction),
  };
}

/**
 * Attach the multi-day accumulation read to each enriched setup (evidence only — never gates here).
 * Mutates in place; sets `flow_accumulation` to null for names with no multi-day signal so the
 * field is always present (explicit "no memory" vs. silently missing).
 */
export function attachFlowAccumulation(
  setups: EnrichedZeroDteSetup[],
  signals: Map<string, FlowAccumulationSignal>
): void {
  for (const s of setups) {
    const sig = signals.get(s.ticker.toUpperCase());
    s.flow_accumulation = sig ? toFlowAccumulationContext(s.direction, sig) : null;
  }
}
