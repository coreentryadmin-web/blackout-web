"use client";

import type { SignalEligibility } from "@/features/helix/lib/helix-signal-detection";

/**
 * States the denominator a signal radar was computed over, when part of the tape could not be
 * scanned at all.
 *
 * WHY IT EXISTS. Both radars' empty states named their THRESHOLD — "≥3× acceleration vs prior
 * 15 min window", "Needs both call and put flow in the last 30 min" — which reads as *"we scanned
 * the tape and nothing cleared the bar."* For most of the tape that is false. Both detectors need
 * a real UW print time to place a print in a window, and MEASURED live 2026-08-23 only 30.0% of
 * rows carry one; the other 70.0% are SPX (3079) and SPY (421), the two names that top every
 * premium panel. "No velocity spikes" on a name that was never scanned is absence published as
 * measurement (_COMMON.md #7).
 *
 * Renders NOTHING when every print was eligible — the common single-ticker case — so the panels
 * stay quiet rather than carrying a permanent caveat nobody reads.
 */
export function SignalCoverageNote({ eligibility }: { eligibility: SignalEligibility }) {
  const { total, eligible, ineligible, ineligibleTickers } = eligibility;
  if (ineligible <= 0 || total <= 0) return null;

  // Name the symbols while the list is short enough to be useful; past that the count is the fact.
  const named = ineligibleTickers.slice(0, 3).join(", ");
  const rest = ineligibleTickers.length - 3;
  const who =
    ineligibleTickers.length === 0
      ? ""
      : rest > 0
        ? ` (${named} +${rest} more)`
        : ` (${named})`;

  return (
    <p className="font-mono text-[10px] leading-relaxed text-amber-300/70 mt-1">
      Scanned {eligible.toLocaleString()} of {total.toLocaleString()} prints —{" "}
      {ineligible.toLocaleString()}
      {who} carry no reported print time and cannot be scanned for this signal.
    </p>
  );
}
