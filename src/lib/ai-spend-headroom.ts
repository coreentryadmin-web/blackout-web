// AI-spend headroom — the number nobody could see on the day it took Largo down.
//
// ── WHY THIS EXISTS ──────────────────────────────────────────────────────────────────────────
//
// `ai-spend-ledger.ts` maintains an exact cross-replica daily spend total, and `anthropic.ts`
// consults it before every model call. Both are correct. What was missing is that **no operator
// surface ever read it**, so "how close are we to the ceiling?" could only be answered by shelling
// into Redis — which is not possible from the audit sandbox at all (raw TCP is blocked).
//
// The consequence, measured 2026-08-21: the fleet ran repeated live Largo probes against a metered
// service while the meter was invisible, the ceiling tripped, and every member question came back
// "I couldn't pull enough live data to answer that". Diagnosing that consumed a day and three
// refuted hypotheses. The ceiling did exactly what it was built to do; the failure was that nobody
// could see it coming or confirm it afterwards.
//
// ── WHY A HEADROOM VERDICT AND NOT JUST A NUMBER ─────────────────────────────────────────────
//
// A raw dollar figure needs the reader to remember the ceiling and do arithmetic, which nobody does
// at 3am. The verdict is the actionable part: `ok` / `warning` / `tripped`, with the fraction that
// produced it, so the admin console can raise it through the same issue machinery as a saturated
// Postgres pool.
//
// ── DISABLED IS NOT HEALTHY ──────────────────────────────────────────────────────────────────
//
// The kill switch is OPT-IN: `DAILY_AI_SPEND_KILL_USD` unset means no ceiling. That state is
// reported as `disabled`, never as `ok`. "No ceiling configured" and "plenty of headroom" are
// different facts and collapsing them would be the same absence-as-fact error this repo keeps
// recording — an unarmed guardrail reading as a green light is precisely how it stays unarmed.

/** Fraction of the ceiling at which the console should start warning. */
export const AI_SPEND_WARN_FRACTION = 0.75;

export type AiSpendHeadroomVerdict = "ok" | "warning" | "tripped" | "disabled" | "unknown";

export type AiSpendHeadroom = {
  verdict: AiSpendHeadroomVerdict;
  /** Org-wide spend for the current ET day, USD. Null when it could not be read. */
  spentUsd: number | null;
  /** The armed ceiling, USD. Null when the kill switch is not armed. */
  ceilingUsd: number | null;
  /** spent / ceiling, rounded to 4dp. Null unless both are known and the ceiling is positive. */
  fraction: number | null;
  /** ceiling - spent, floored at 0. Null unless both are known. */
  remainingUsd: number | null;
  reason: string;
};

/**
 * Grade the current spend against the armed ceiling.
 *
 * `spentUsd` null means the ledger could not be read — reported `unknown`, never `ok`, because a
 * spend figure that failed to load is the moment a runaway loop is least visible.
 */
export function evaluateAiSpendHeadroom({
  spentUsd,
  ceilingUsd,
  warnFraction = AI_SPEND_WARN_FRACTION,
}: {
  spentUsd: number | null | undefined;
  ceilingUsd: number | null | undefined;
  warnFraction?: number;
}): AiSpendHeadroom {
  const ceiling = typeof ceilingUsd === "number" && Number.isFinite(ceilingUsd) && ceilingUsd > 0 ? ceilingUsd : null;
  const spent = typeof spentUsd === "number" && Number.isFinite(spentUsd) && spentUsd >= 0 ? spentUsd : null;

  if (ceiling == null) {
    return {
      verdict: "disabled",
      spentUsd: spent,
      ceilingUsd: null,
      fraction: null,
      remainingUsd: null,
      reason:
        "DAILY_AI_SPEND_KILL_USD is not armed — there is no org-wide ceiling. This is NOT the same as having headroom.",
    };
  }
  if (spent == null) {
    return {
      verdict: "unknown",
      spentUsd: null,
      ceilingUsd: ceiling,
      fraction: null,
      remainingUsd: null,
      reason: "daily spend ledger unreadable — headroom cannot be judged, do not treat as healthy",
    };
  }

  const fraction = Math.round((spent / ceiling) * 10_000) / 10_000;
  const remainingUsd = Math.max(0, Math.round((ceiling - spent) * 100) / 100);

  if (spent >= ceiling) {
    return {
      verdict: "tripped",
      spentUsd: spent,
      ceilingUsd: ceiling,
      fraction,
      remainingUsd,
      reason:
        `daily AI spend $${spent.toFixed(2)} has reached the $${ceiling.toFixed(2)} ceiling — ` +
        `Largo is refusing new queries until ET midnight`,
    };
  }
  if (fraction >= warnFraction) {
    return {
      verdict: "warning",
      spentUsd: spent,
      ceilingUsd: ceiling,
      fraction,
      remainingUsd,
      reason:
        `daily AI spend $${spent.toFixed(2)} is ${(fraction * 100).toFixed(0)}% of the ` +
        `$${ceiling.toFixed(2)} ceiling — $${remainingUsd.toFixed(2)} left before Largo stops answering`,
    };
  }
  return {
    verdict: "ok",
    spentUsd: spent,
    ceilingUsd: ceiling,
    fraction,
    remainingUsd,
    reason: `daily AI spend $${spent.toFixed(2)} of $${ceiling.toFixed(2)} ceiling`,
  };
}

/**
 * The admin-console issue for a headroom verdict, or null when there is nothing to raise.
 *
 * `disabled` and `unknown` DO raise — quietly, as warnings. An unarmed ceiling and an unreadable
 * ledger are both states an operator should know about, and neither will ever announce itself.
 */
export function aiSpendHeadroomIssue(h: AiSpendHeadroom): {
  id: string;
  severity: "critical" | "warning";
  category: string;
  title: string;
  detail: string;
} | null {
  if (h.verdict === "ok") return null;
  const severity = h.verdict === "tripped" ? "critical" : "warning";
  const title =
    h.verdict === "tripped"
      ? "Largo paused — daily AI spend ceiling reached"
      : h.verdict === "warning"
        ? "Daily AI spend approaching the ceiling"
        : h.verdict === "disabled"
          ? "AI spend kill-switch is not armed"
          : "Daily AI spend is unreadable";
  return { id: `ai_spend:${h.verdict}`, severity, category: "cost", title, detail: h.reason };
}
