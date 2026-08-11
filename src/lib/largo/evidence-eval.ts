/**
 * EVIDENCE EVALUATORS — the pure half of the two evidence reads.
 *
 * SPLIT FROM `evidence-reads.ts` FOR TESTABILITY, the same shape the audit tooling already uses
 * (`lib/e2e-schema-checks.mjs`, `lib/grading-agreement-eval.mjs`): the IO wrapper carries
 * `server-only`, which makes the module unimportable from a test, so the comparison logic — the
 * part with the honesty rules worth pinning — lives here with no IO and no clock.
 */

import { isZeroDteWin, officialPlanOutcome, officialPlanPnlPct, type OfficialGradableRow } from "@/lib/zerodte/record";

export type GraderAgreementForLargo = {
  available: boolean;
  window_days: number;
  total_plays: number;
  /** Rows carrying evidence on BOTH lanes — the only population that can test the invariant. */
  comparable: number;
  agreed: number;
  agreement_pct: number | null;
  grader_a: string;
  grader_b: string;
  disagreements: { ticker: string; date: string | null; mid: string; official: string }[];
  note?: string;
};

export type LedgerRowLike = {
  ticker?: unknown;
  plan_outcome?: unknown;
  plan_pnl_pct?: unknown;
  entry_context?: unknown;
  session_date?: unknown;
  edition_for?: unknown;
};

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * Compare the MID (mechanical) lane against the OFFICIAL (executable / as-executed) lane.
 *
 * WHAT THIS IS AND IS NOT. When `outcome-grading-audit.mjs` was written, `feature-store.ts`'s
 * `labelFromPlanOutcome` and `record.ts`'s `isZeroDteWin` were two implementations that could
 * disagree. They are no longer: `labelFromPlanOutcome` now DELEGATES to `isZeroDteWin`, with a
 * comment calling it "the shared source of truth, not a hand copy". Describing them as two
 * independent graders today would be wrong.
 *
 * What remains real, and is what the audit script actually measured, is the two LANES: the raw mid
 * columns (`plan_pnl_pct`) versus the executable grade WS-10 stamps at
 * `entry_context.executable`. A row partially banked by WS-11 can be `stopped −50%` on the mid lane
 * and a WIN on the official one. That is a genuine methodological difference, not a defect — and
 * it is the thing worth publishing, because the official lane is what the member was actually
 * guided to.
 *
 * The official side calls the REAL `isZeroDteWin`; the mid side is the raw column. No third
 * implementation is introduced.
 */
export function compareGraderLanes(
  rows: readonly LedgerRowLike[]
): Omit<GraderAgreementForLargo, "available" | "window_days" | "grader_a" | "grader_b" | "note"> {
  let comparable = 0;
  let agreed = 0;
  const disagreements: GraderAgreementForLargo["disagreements"] = [];

  for (const raw of rows) {
    const entryContext =
      raw.entry_context != null && typeof raw.entry_context === "object" && !Array.isArray(raw.entry_context)
        ? (raw.entry_context as Record<string, unknown>)
        : null;
    const row: OfficialGradableRow = {
      plan_outcome: typeof raw.plan_outcome === "string" ? raw.plan_outcome : null,
      plan_pnl_pct: num(raw.plan_pnl_pct),
      entry_context: entryContext,
    };

    const midPnl = row.plan_pnl_pct;
    const officialPnl = officialPlanPnlPct(row);
    // BOTH lanes must have a number. A row with no mid grade cannot test agreement, and counting
    // it as agreement would inflate the rate with rows that were never compared.
    if (midPnl == null || officialPnl == null) continue;

    comparable += 1;
    const midWin = midPnl > 0;
    const officialWin = isZeroDteWin(row);
    if (midWin === officialWin) {
      agreed += 1;
      continue;
    }
    const pct = (v: number) => `${v < 0 ? "−" : "+"}${Math.abs(v).toFixed(1)}%`;
    disagreements.push({
      ticker: typeof raw.ticker === "string" ? raw.ticker.toUpperCase() : "—",
      date:
        typeof raw.session_date === "string"
          ? raw.session_date.slice(0, 10)
          : typeof raw.edition_for === "string"
            ? raw.edition_for.slice(0, 10)
            : null,
      mid: `${row.plan_outcome ?? "graded"} ${pct(midPnl)}`,
      official: `${officialPlanOutcome(row) ?? "graded"} ${pct(officialPnl)}`,
    });
  }

  return {
    total_plays: rows.length,
    comparable,
    agreed,
    agreement_pct: comparable > 0 ? Math.round((agreed / comparable) * 1000) / 10 : null,
    disagreements,
  };
}

