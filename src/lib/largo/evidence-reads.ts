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

/** Same rule as `GraderAgreementForLargo`: a scalar that was not measured is `null`, and a list
 *  that was not measured is ABSENT — an empty `by_gate` invites "no gate blocked anything", which
 *  is the opposite of what a failed read means. */
export type GateValueForLargo = {
  available: boolean;
  window_days: number;
  /** Every gate-blocked play in the window, whether or not it could be graded. */
  blocked_total: number | null;
  /** Of those, counterfactually graded on real bars. NEVER assumed equal to blocked_total. */
  graded_total: number | null;
  /** Graded plays the gate was right about — they would have lost. */
  would_have_lost_total: number | null;
  /** Graded plays the gate cost us — they would have won. This is the number that makes the
   *  measurement honest, and it is required rather than optional for exactly that reason. */
  would_have_won_total: number | null;
  /** Blocked plays that would not even have filled — the gate was trivially right. Kept out of
   *  the won/lost read, per `gateBlockedValue`'s own contract. */
  unfilled_total: number | null;
  by_gate?: GateBlockedValueLine[];
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

    // `available: inputs.length > 0` reported a SUCCESSFUL read of a quiet window as if the tool
    // were unavailable. "The publish gate blocked nothing in 30 days" is a real measurement — and
    // an important one, since a gate that never fires may be miscalibrated — but Largo could never
    // say it, because the payload told the model there was no data. The read succeeded.
    return {
      available: true,
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
    // Five zeros used to ship here. "0 plays blocked" on a FAILED read is the most misleading
    // number this tool can produce: the gate's entire value proposition is the count of bad plays
    // it stopped, so a broken read published the gate as having done nothing.
    return {
      available: false,
      window_days: windowDays,
      blocked_total: null,
      graded_total: null,
      would_have_lost_total: null,
      would_have_won_total: null,
      unfilled_total: null,
      note:
        `gate-value read failed: ${err instanceof Error ? err.message : String(err)} — ` +
        `none of these totals is a measurement. Do not say the gate blocked nothing.`,
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
    // Was four zeros and an empty list. `agreement_pct` in the same object already knew to be
    // null; the counts did not, so a failed read published "0 plays, 0 comparable, 0 agreed"
    // as though it had looked. Nothing here was measured, so nothing here is a number.
    return {
      ...base,
      available: false,
      total_plays: null,
      comparable: null,
      agreed: null,
      agreement_pct: null,
      note: "database_unavailable — nothing was read, so none of these counts is a measurement.",
    };
  }
  try {
    // The SAME fetch `zerodteRecordForLargo` uses, so the agreement rate is measured over exactly
    // the rows the published record is built from — not a differently-scoped sample.
    const since = formatEtDate(new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000));
    const rows = (await fetchZeroDteSetupLogRange(since, Math.min(2000, windowDays * 20))) as LedgerRowLike[];
    const cmp = compareGraderLanes(rows);
    // `available: cmp.comparable > 0` reported a SUCCESSFUL read of a window with nothing to
    // compare as if the tool were unavailable — and threw away `total_plays`, which is a real
    // measurement of that window. "We looked at 54 plays and none carries a grade on both lanes"
    // is an answer, and a useful one; "unavailable" is not. The read succeeded, so available is
    // true and the missing RATE stays null.
    return {
      ...base,
      ...cmp,
      available: true,
      note:
        (cmp.comparable ?? 0) === 0
          ? "No rows in this window carry a grade on both lanes, so there is no agreement rate " +
            "to quote. This is a MEASURED result over `total_plays`, not a failed read."
          : undefined,
    };
  } catch (err) {
    return {
      ...base,
      available: false,
      total_plays: null,
      comparable: null,
      agreed: null,
      agreement_pct: null,
      note:
        `grader comparison failed: ${err instanceof Error ? err.message : String(err)} — ` +
        `none of these counts is a measurement.`,
    };
  }
}
