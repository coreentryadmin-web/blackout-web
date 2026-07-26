/**
 * "WHY NOW" — the trigger reason that surfaced a 0DTE play (Night Hawk Wave 3).
 *
 * The board reacts to the TAPE, not just the clock (scan-trigger.ts): a material sweep, a
 * multi-day accumulation build, a breakout, a gamma-wall pin. The member never saw WHICH of
 * those actually put this play on the board. This module derives that one-line reason from the
 * signals ALREADY committed on the setup — nothing new is measured — so the terminal can render
 * an honest "⚡ triggered by: …" ribbon.
 *
 * HONEST BY CONSTRUCTION: every reason maps to a REAL, committed signal on the setup. When none
 * is present the derivation returns null and the ribbon is omitted — never a fabricated reason.
 * The derived object is pinned into entry_context at commit (scan.ts) so it survives for a
 * working position long after the fresh scan that found it; a legacy row with no pin reads null.
 *
 * Pure + dependency-free (no clock, no IO, no DB types) so it is trivially unit-testable and
 * usable by both the commit path and any offline reader.
 */

/** The trigger taxonomy — each backed by a committed setup signal (see deriveWhyNow). */
export type WhyNowReason =
  | "accumulation" // multi-day stacked flow build (flow_accumulation.days ≥ 2)
  | "breakout" // BREAKOUT discovery rail surfaced it
  | "pin" // PIN (gamma-wall) discovery rail surfaced it
  | "sweep" // aggressive swept flow (sweep_pct over the material threshold)
  | "flow_spike" // sudden 30-minute flow surge (setup.spike)
  | "aggressor_flow"; // plain FLOW rail — dominant at-the-ask aggressor tape

/** A resolved trigger reason for one play. `label` is the member-facing phrase for the ribbon. */
export interface WhyNow {
  reason: WhyNowReason;
  label: string;
}

/** Share of the tape that must be SWEPT before we call the trigger a "sweep" (matches the
 *  material-flow intuition in scan-trigger.ts — an aggressive, swept print, not a lone lift). */
export const WHY_NOW_SWEEP_PCT = 0.5;
/** Distinct ET days a multi-day build must span to count as accumulation (a one-off print is not). */
export const WHY_NOW_ACCUMULATION_MIN_DAYS = 2;

/** The subset of setup signals the derivation reads — all already committed on EnrichedZeroDteSetup. */
export interface WhyNowSignals {
  discovery_origin?: string[] | null;
  /** Premium-weighted swept share of the tape (0–1). */
  sweep_pct?: number | null;
  /** Sudden-flow-spike flag: ≥ half the tape arrived in the last 30m. */
  spike?: boolean | null;
  /** Multi-day accumulation read (flow-accumulation-context.ts) — `days` is the persistence. */
  flow_accumulation?: { days?: number | null } | null;
}

const hasOrigin = (origins: string[] | null | undefined, o: string): boolean =>
  Array.isArray(origins) && origins.includes(o);

/**
 * Derive the ONE trigger reason that best explains why this play surfaced, from most-specific
 * (a durable multi-day build) to most-generic (plain aggressor flow). Returns null when no
 * committed signal supports any reason — the ribbon is then omitted (honest absence).
 */
export function deriveWhyNow(sig: WhyNowSignals): WhyNow | null {
  const days = sig.flow_accumulation?.days ?? null;
  if (days != null && Number.isFinite(days) && days >= WHY_NOW_ACCUMULATION_MIN_DAYS) {
    return { reason: "accumulation", label: `multi-day accumulation (${Math.round(days)}d build)` };
  }
  if (hasOrigin(sig.discovery_origin, "BREAKOUT")) {
    return { reason: "breakout", label: "breakout momentum" };
  }
  if (hasOrigin(sig.discovery_origin, "PIN")) {
    return { reason: "pin", label: "gamma-wall pin" };
  }
  const sweep = sig.sweep_pct;
  if (sweep != null && Number.isFinite(sweep) && sweep >= WHY_NOW_SWEEP_PCT) {
    return { reason: "sweep", label: "aggressive sweep" };
  }
  if (sig.spike === true) {
    return { reason: "flow_spike", label: "flow spike (30m surge)" };
  }
  if (hasOrigin(sig.discovery_origin, "FLOW")) {
    return { reason: "aggressor_flow", label: "dominant aggressor flow" };
  }
  return null;
}

/** Structural, fail-soft reader for a WhyNow pinned on a row's entry_context (why_now). Any
 *  missing/malformed shape → null (the terminal shows no ribbon), never a fabricated reason. */
export function readPinnedWhyNow(entryContext: Record<string, unknown> | null | undefined): WhyNow | null {
  const wn = entryContext?.why_now;
  if (!wn || typeof wn !== "object") return null;
  const rec = wn as Record<string, unknown>;
  const reason = rec.reason;
  const label = rec.label;
  const REASONS: WhyNowReason[] = ["accumulation", "breakout", "pin", "sweep", "flow_spike", "aggressor_flow"];
  if (typeof reason !== "string" || !REASONS.includes(reason as WhyNowReason)) return null;
  if (typeof label !== "string" || label.length === 0) return null;
  return { reason: reason as WhyNowReason, label };
}
