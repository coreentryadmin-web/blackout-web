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

/** The graded label the store learns from. `null` = not (yet) gradeable evidence. */
export type GradeLabel = "win" | "loss";

/**
 * Map a plan's grade (zerodte_setup_log.plan_outcome, graded vs the contract's own minute bars) to a
 * win/loss label.
 *
 * The OUTCOME gates evidence: only `doubled` / `stopped` / `time_stop` are real grades — mirrors
 * record.ts `isGradedZeroDteRow`. Anything else (`ungradeable`, an open row, an unknown string) is
 * NOT evidence → null.
 *
 * The WIN/LOSS itself is decided by realized plan P&L — `plan_pnl_pct > 0` — the EXACT predicate
 * record.ts `isZeroDteWin` and the calibration harness use, so the learning store can never disagree
 * with the member-facing record on what a win is. This matters for `time_stop`: a GREEN time_stop
 * (closed above entry before 15:30) is a WIN, not a loss. The prior `doubled`-only rule scored every
 * profitable-but-under-target trade as a loss — a systematic bias against the engine's real base rate.
 */
export function labelFromPlanOutcome(
  outcome: string | null | undefined,
  planPnlPct?: number | null
): GradeLabel | null {
  switch ((outcome ?? "").toLowerCase()) {
    case "doubled":
    case "stopped":
    case "time_stop":
      // Win = positive plan P&L (identical to record.ts isZeroDteWin). doubled always prints +100
      // and stopped −50, so those are unchanged; only a green time_stop flips to a win.
      return (planPnlPct ?? 0) > 0 ? "win" : "loss";
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
}

/**
 * Shape raw joined rows into GradedFeatureRows, dropping everything that isn't real evidence: no feature
 * vector, or a plan_outcome that doesn't grade to win/loss. Never fabricates a label. Order is preserved.
 */
export function toGradedFeatureRows(raw: RawGradedRow[]): GradedFeatureRow[] {
  const out: GradedFeatureRow[] = [];
  for (const r of raw) {
    const pnl = typeof r.plan_pnl_pct === "number" && Number.isFinite(r.plan_pnl_pct) ? r.plan_pnl_pct : null;
    // Win/loss is decided by realized P&L (pnl > 0), so the label must see it — a green time_stop
    // is a win, matching record.ts isZeroDteWin. See labelFromPlanOutcome.
    const label = labelFromPlanOutcome(typeof r.plan_outcome === "string" ? r.plan_outcome : null, pnl);
    if (!label) continue; // not gradeable → not evidence
    const fv = r.feature_vector;
    if (!fv || typeof fv !== "object") continue; // no pinned vector → nothing to learn from
    out.push({
      ticker: typeof r.ticker === "string" ? r.ticker : "",
      sessionDate: typeof r.session_date === "string" ? r.session_date : "",
      features: fv as SetupFeatureVector,
      label,
      pnlPct: pnl,
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
