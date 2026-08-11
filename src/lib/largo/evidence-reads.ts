import "server-only";

/**
 * EVIDENCE READS — the two measurements that were computed and never served.
 *
 * Both of these existed as OFFLINE AUDIT SCRIPTS (`firewall-rth-replay.mjs`,
 * `outcome-grading-audit.mjs`) whose findings lived in `docs/audit/FINDINGS.md` and nowhere a
 * member could reach. The COUNTERFACTUAL half is worse than that: the nightly cron has been
 * grading gate-blocked plays and persisting the result for weeks (`runNighthawkRejectionCounterfactuals`
 * → `setNighthawkRejectionCounterfactual`), and `gateBlockedValue` — the aggregator that turns
 * those rows into per-gate value — had exactly one caller, inside an admin-only analytics report.
 *
 * The data was there. The maths was there. Nothing carried it to the answering layer. Same class
 * as helix-signal-outcomes, Vector Pulse, the Helix derivations and the Vector analytics.
 *
 * NOTHING IS RE-DERIVED HERE. Both reads call the REAL production functions —
 * `gateBlockedValue`/`gateCodesFromSnapshot` for the gate value, `isZeroDteWin`/`officialPlanPnlPct`
 * for the grader comparison. A parallel implementation would drift the moment a threshold moved,
 * and Largo would then publish a number that disagrees with the desk's own report while both were
 * individually "correct".
 */

import {
  gateBlockedValue,
  gateCodesFromSnapshot,
  type GateBlockedValueLine,
  type NighthawkGateRejectionInput,
} from "@/features/nighthawk/lib/debrief-aggregate";
import { dbConfigured, fetchNighthawkPublishGateRejections, fetchZeroDteSetupLogRange } from "@/lib/db";
import { formatEtDate } from "@/features/nighthawk/lib/session";
import { compareGraderLanes, type GraderAgreementForLargo, type LedgerRowLike } from "@/lib/largo/evidence-eval";

export { compareGraderLanes };
export type { GraderAgreementForLargo };

// ── Gate-blocked value (the counterfactual) ────────────────────────────────────────────────

export type GateValueForLargo = {
  available: boolean;
  window_days: number;
  /** Every gate-blocked play in the window, whether or not it could be graded. */
  blocked_total: number;
  /** Of those, counterfactually graded on real bars. NEVER assumed equal to blocked_total. */
  graded_total: number;
  /** Graded plays the gate was right about — they would have lost. */
  would_have_lost_total: number;
  /** Graded plays the gate cost us — they would have won. This is the number that makes the
   *  measurement honest, and it is required rather than optional for exactly that reason. */
  would_have_won_total: number;
  /** Blocked plays that would not even have filled — the gate was trivially right. Kept out of
   *  the won/lost read, per `gateBlockedValue`'s own contract. */
  unfilled_total: number;
  by_gate: GateBlockedValueLine[];
  note?: string;
};

/**
 * Per-gate blocked value over the window.
 *
 * `ungradedOnly: false` — the cron grades with `ungradedOnly: true` because it only needs to fill
 * gaps; a READ wants everything already graded, which is the opposite selection.
 */
export async function gateBlockedValueForLargo(days = 30): Promise<GateValueForLargo> {
  const windowDays = Number.isFinite(days) && days > 0 ? Math.min(120, Math.trunc(days)) : 30;
  try {
    const rows = await fetchNighthawkPublishGateRejections(windowDays, { limit: 1000 });
    const inputs: NighthawkGateRejectionInput[] = rows.map((r) => ({
      ticker: r.ticker,
      edition_for: r.edition_for,
      direction: r.direction,
      gate_codes: gateCodesFromSnapshot(r.input_snapshot),
      counterfactual: r.counterfactual_json,
    }));
    const byGate = gateBlockedValue(inputs);

    // TOTALS ARE COUNTED OVER PLAYS, NOT SUMMED OVER GATES. A play blocked by two gates appears
    // under both lines (a DELL-class play carries band_detached AND target_unreachable), so adding
    // the per-gate numbers would double-count it and inflate every total on the card.
    const graded = inputs
      .map((i) => i.counterfactual)
      .filter((c): c is Record<string, unknown> => c != null && typeof c === "object" && !Array.isArray(c))
      .map((c) => ({ outcome: String(c.outcome ?? ""), won: c.would_have_won === true }))
      .filter((c) => c.outcome && c.outcome !== "ungradeable");
    const unfilled = graded.filter((g) => g.outcome === "unfilled");
    const decisive = graded.filter((g) => g.outcome !== "unfilled");
    const won = decisive.filter((g) => g.won).length;

    return {
      available: inputs.length > 0,
      window_days: windowDays,
      blocked_total: inputs.length,
      graded_total: graded.length,
      would_have_lost_total: decisive.length - won,
      would_have_won_total: won,
      unfilled_total: unfilled.length,
      by_gate: byGate,
      note:
        inputs.length === 0
          ? "No gate-blocked plays recorded in this window."
          : graded.length === 0
            ? "Blocked plays are recorded but none have been counterfactually graded yet."
            : undefined,
    };
  } catch (err) {
    return {
      available: false,
      window_days: windowDays,
      blocked_total: 0,
      graded_total: 0,
      would_have_lost_total: 0,
      would_have_won_total: 0,
      unfilled_total: 0,
      by_gate: [],
      note: `gate-value read failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

// ── Grader agreement ───────────────────────────────────────────────────────────────────────

export async function graderAgreementForLargo(days = 90): Promise<GraderAgreementForLargo> {
  const windowDays = Number.isFinite(days) && days > 0 ? Math.min(365, Math.trunc(days)) : 90;
  const base = {
    window_days: windowDays,
    grader_a: "mid lane · mechanical plan grade",
    grader_b: "official lane · executable / as-executed",
  };
  if (!dbConfigured()) {
    return {
      ...base,
      available: false,
      total_plays: 0,
      comparable: 0,
      agreed: 0,
      agreement_pct: null,
      disagreements: [],
      note: "database_unavailable",
    };
  }
  try {
    // The SAME fetch `zerodteRecordForLargo` uses, so the agreement rate is measured over exactly
    // the rows the published record is built from — not a differently-scoped sample.
    const since = formatEtDate(new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000));
    const rows = (await fetchZeroDteSetupLogRange(since, Math.min(2000, windowDays * 20))) as LedgerRowLike[];
    const cmp = compareGraderLanes(rows);
    return {
      ...base,
      ...cmp,
      available: cmp.comparable > 0,
      note:
        cmp.comparable === 0
          ? "No rows in this window carry a grade on both lanes — nothing to compare."
          : undefined,
    };
  } catch (err) {
    return {
      ...base,
      available: false,
      total_plays: 0,
      comparable: 0,
      agreed: 0,
      agreement_pct: null,
      disagreements: [],
      note: `grader comparison failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
