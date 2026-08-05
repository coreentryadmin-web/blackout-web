/**
 * 0DTE FEATURE STORE — the READ side of the keystone.
 *
 * The write side (feature-vector.ts + the scan.ts persist + the flow-quality/regime threading) stamps
 * one SetupFeatureVector per committed setup, COALESCE-pinned at first flag. This module is what the
 * intelligence layer reads back: it joins each pinned vector to that setup's GRADED outcome and turns
 * the pile into honest base rates the probability / Bayesian / similarity layers build on.
 *
 * Two hard rules, both calibration-first (evidence, never a guess):
 *   1. A setup counts only once it is actually GRADED to a win/loss — an ungradeable or still-open row
 *      is not evidence and is dropped, never coerced to a loss.
 *   2. A base rate is reported only above MIN_SAMPLES. Below it the rate is `null` (unknown), not a
 *      point estimate off 3 trades that reads as fact. A null base rate is honest; a 2/3 = "67%" is a lie.
 *
 * PURE & deterministic — no IO. The DB read that supplies the rows (fetchGradedFeatureVectorRows) lives
 * in db.ts; this module only shapes + summarizes what it returns, so it is unit-testable with plain rows.
 */

import type { SetupFeatureVector } from "./feature-vector";
import { isZeroDteWin, officialPlanPnlPct, type OfficialGradableRow } from "./record";

/** The graded label the store learns from. `null` = not (yet) gradeable evidence. */
export type GradeLabel = "win" | "loss";

/**
 * Map a plan's grade (zerodte_setup_log.plan_outcome / plan_pnl_pct, plus the row's optional
 * entry_context) to a win/loss label.
 *
 * The OUTCOME gates evidence: only `doubled` / `stopped` / `time_stop` are real grades — mirrors
 * record.ts `isGradedZeroDteRow`. Anything else (`ungradeable`, an open row, an unknown string,
 * or a condor row's disjoint `condor_win`/`condor_breach_loss` vocabulary) is NOT evidence → null.
 *
 * NH-R14 follow-up (docs/audit/OUTCOME-GRADING-SPEC.md §4, FINDINGS.md 2026-08-05): this used to
 * decide WIN/LOSS off the raw MID `plan_pnl_pct` alone, with an in-code comment claiming that was
 * "the EXACT predicate record.ts `isZeroDteWin` … uses, so the learning store can never disagree
 * with the member-facing record" — a live 90-day audit found that FALSE for any row that had since
 * been executable-graded (WS-10) or reconstructed (WS-11 trim-scale): record.ts prefers that
 * official/executable/reconstructed lane over the mid columns, so a mid `stopped` (−50%) row could
 * be an official WIN (partial-banking legs recovered it) and vice versa — 4/130 real rows disagreed
 * (MU/SPXW/META 2026-07-29..08-03 mid-loss-but-official-win; OKLO 2026-07-30 the other direction).
 *
 * The FIX: call the SAME shared pure predicate record.ts exports (`isZeroDteWin`, over
 * `OfficialGradableRow`) instead of re-deciding win/loss from the mid columns by hand — so this can
 * no longer drift out of sync the way the "byte-identical" comment silently did. `entryContext` is
 * optional so legacy call sites (and legacy/pre-WS10 rows, which have none) still resolve to the
 * exact same mid-column answer as before; passing it is what lets a WS-10/WS-11-graded row resolve
 * to the OFFICIAL label instead.
 */
export function labelFromPlanOutcome(
  outcome: string | null | undefined,
  planPnlPct?: number | null,
  entryContext?: Record<string, unknown> | null
): GradeLabel | null {
  switch ((outcome ?? "").toLowerCase()) {
    case "doubled":
    case "stopped":
    case "time_stop": {
      const row: OfficialGradableRow = {
        plan_outcome: outcome ?? null,
        plan_pnl_pct: planPnlPct ?? null,
        entry_context: entryContext ?? null,
      };
      // record.ts's own predicate: official (executable/reconstructed, WS-10/WS-11) lane
      // preferred, mid fallback for legacy rows — the shared source of truth, not a hand copy.
      return isZeroDteWin(row) ? "win" : "loss";
    }
    default:
      return null; // ungradeable / open / unknown — not evidence
  }
}

/** One row of the store: a pinned feature vector joined to its graded outcome. */
export interface GradedFeatureRow {
  ticker: string;
  sessionDate: string;
  features: SetupFeatureVector;
  label: GradeLabel;
  /** Realized plan P&L %, when the grader recorded one (null = graded by direction only). */
  pnlPct: number | null;
}

/**
 * A raw joined row as the DB read hands it over: the pinned feature_vector JSONB + the grade columns.
 * Deliberately loose (Record) so db.ts can pass rows straight through without a shared import cycle.
 */
export interface RawGradedRow {
  ticker?: unknown;
  session_date?: unknown;
  feature_vector?: unknown;
  plan_outcome?: unknown;
  plan_pnl_pct?: unknown;
  /** WS-10/WS-11 executable / reconstructed-trim-scale blob, when the row carries one (NH-R14
   *  follow-up widening — see labelFromPlanOutcome). Optional/loose like the rest of this row: a
   *  fixture or a pre-widening caller that omits it still typechecks and falls back to mid. */
  entry_context?: unknown;
}

/**
 * Shape raw joined rows into GradedFeatureRows, dropping everything that isn't real evidence: no feature
 * vector, or a plan_outcome that doesn't grade to win/loss. Never fabricates a label. Order is preserved.
 */
export function toGradedFeatureRows(raw: RawGradedRow[]): GradedFeatureRow[] {
  const out: GradedFeatureRow[] = [];
  for (const r of raw) {
    const pnl = typeof r.plan_pnl_pct === "number" && Number.isFinite(r.plan_pnl_pct) ? r.plan_pnl_pct : null;
    const outcome = typeof r.plan_outcome === "string" ? r.plan_outcome : null;
    const entryContext =
      r.entry_context && typeof r.entry_context === "object" ? (r.entry_context as Record<string, unknown>) : null;
    // Win/loss is decided by the OFFICIAL (executable/reconstructed-preferred, mid-fallback) P&L —
    // see labelFromPlanOutcome, which now shares record.ts's isZeroDteWin predicate instead of
    // reading planPnlPct (mid) alone.
    const label = labelFromPlanOutcome(outcome, pnl, entryContext);
    if (!label) continue; // not gradeable → not evidence
    const fv = r.feature_vector;
    if (!fv || typeof fv !== "object") continue; // no pinned vector → nothing to learn from
    // The realized P&L the store reports alongside the label is the SAME official number the label
    // was decided from (executable/reconstructed-preferred), not the raw mid column — so a mean-EV
    // read over pnlPct can never disagree in sign with the win/loss label it's paired with.
    const officialPnl = officialPlanPnlPct({ plan_outcome: outcome, plan_pnl_pct: pnl, entry_context: entryContext });
    out.push({
      ticker: typeof r.ticker === "string" ? r.ticker : "",
      sessionDate: typeof r.session_date === "string" ? r.session_date : "",
      features: fv as SetupFeatureVector,
      label,
      pnlPct: officialPnl,
    });
  }
  return out;
}

/** Below this many graded samples a win-rate is UNKNOWN (null), never a point estimate. */
export const MIN_SAMPLES = 20;

/** A win-rate cell: the counts are always honest; `winRate` is null until MIN_SAMPLES is met. */
export interface BaseRate {
  n: number;
  wins: number;
  /** wins / n, but only once n ≥ MIN_SAMPLES — else null (not enough evidence to state a rate). */
  winRate: number | null;
  /** Sum of realized plan P&L % over the cell's rows that recorded one (for a mean-EV read). */
  pnlSum: number;
  /** How many rows in the cell recorded a realized P&L % (denominator for the mean). */
  pnlN: number;
}

function emptyRate(): BaseRate {
  return { n: 0, wins: 0, winRate: null, pnlSum: 0, pnlN: 0 };
}

function addToRate(cell: BaseRate, row: GradedFeatureRow): void {
  cell.n += 1;
  if (row.label === "win") cell.wins += 1;
  if (row.pnlPct != null) {
    cell.pnlSum += row.pnlPct;
    cell.pnlN += 1;
  }
}

/** Finalize a cell: fill winRate only when the sample clears the floor (calibration-first). */
function sealRate(cell: BaseRate): BaseRate {
  cell.winRate = cell.n >= MIN_SAMPLES ? cell.wins / cell.n : null;
  return cell;
}

/** Score band a setup committed in (mirrors the gate stack's tiers). */
export function scoreBand(score: number | null | undefined): string {
  if (score == null || !Number.isFinite(score)) return "unknown";
  if (score >= 85) return "85+";
  if (score >= 75) return "75-84";
  if (score >= 65) return "65-74";
  return "<65";
}

/** Flow-quality band (fq_score is 0-100; null when flow-quality wasn't threaded to that row). */
export function flowQualityBand(fq: number | null | undefined): string {
  if (fq == null || !Number.isFinite(fq)) return "unknown";
  if (fq >= 75) return "strong";
  if (fq >= 50) return "solid";
  if (fq >= 25) return "weak";
  return "poor";
}

/** The store's honest read: overall base rate + the cuts the calibration layer cares about first. */
export interface FeatureStoreSummary {
  overall: BaseRate;
  byRegimeStructure: Record<string, BaseRate>;
  byScoreBand: Record<string, BaseRate>;
  byFlowQualityBand: Record<string, BaseRate>;
  /** Rows that were graded evidence but whose feature vector predates flow-quality threading
   *  (fq_score null) — surfaced so "unknown" cells aren't mistaken for real signal. */
  fqCoverage: { withFq: number; withoutFq: number };
  regimeCoverage: { withRegime: number; withoutRegime: number };
}

function bump(map: Record<string, BaseRate>, key: string, row: GradedFeatureRow): void {
  (map[key] ??= emptyRate());
  addToRate(map[key]!, row);
}

/**
 * Summarize the graded store into base rates. Every cut is sample-guarded: counts are always exact,
 * but a winRate stays null until the cell has ≥ MIN_SAMPLES graded rows, so a thin cut can't masquerade
 * as a calibrated edge. This is the raw material the probability/Bayesian layers refine — not a gate.
 */
export function summarizeFeatureStore(rows: GradedFeatureRow[]): FeatureStoreSummary {
  const overall = emptyRate();
  const byRegimeStructure: Record<string, BaseRate> = {};
  const byScoreBand: Record<string, BaseRate> = {};
  const byFlowQualityBand: Record<string, BaseRate> = {};
  let withFq = 0;
  let withoutFq = 0;
  let withRegime = 0;
  let withoutRegime = 0;

  for (const row of rows) {
    addToRate(overall, row);
    const f = row.features;
    const fq = typeof f.fq_score === "number" ? f.fq_score : null;
    const reg = typeof f.reg_structure === "string" ? f.reg_structure : null;
    if (fq != null) withFq += 1;
    else withoutFq += 1;
    if (reg != null) withRegime += 1;
    else withoutRegime += 1;
    bump(byRegimeStructure, reg ?? "unknown", row);
    bump(byScoreBand, scoreBand(typeof f.evidence_score === "number" ? f.evidence_score : null), row);
    bump(byFlowQualityBand, flowQualityBand(fq), row);
  }

  sealRate(overall);
  for (const m of [byRegimeStructure, byScoreBand, byFlowQualityBand]) {
    for (const k of Object.keys(m)) sealRate(m[k]!);
  }

  return {
    overall,
    byRegimeStructure,
    byScoreBand,
    byFlowQualityBand,
    fqCoverage: { withFq, withoutFq },
    regimeCoverage: { withRegime, withoutRegime },
  };
}
