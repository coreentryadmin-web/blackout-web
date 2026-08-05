/**
 * Pure helpers for scripts/audit/outcome-grading-audit.mjs — factored out so the row-shaping
 * logic (which reconstructs the MID (mechanical) plan_outcome/plan_pnl_pct a ledger row's raw
 * DB columns carry, from what the live /api/market/zerodte/record API actually serves) has a
 * regression test independent of live auth/network.
 *
 * BACKGROUND (see docs/audit/OUTCOME-GRADING-SPEC.md §"Checked invariant"): feature-store.ts's
 * `labelFromPlanOutcome` reads the RAW `zerodte_setup_log.plan_outcome` / `plan_pnl_pct` columns
 * (the MID/mechanical grade, gradePlanFromBars) — see db.ts `fetchGradedFeatureVectorRows`, which
 * selects those two columns straight, with no join to entry_context. record.ts's `isZeroDteWin` /
 * `isGradedZeroDteRow` instead read the OFFICIAL WS-10 conservative-EXECUTABLE lane
 * (`entry_context.executable`, via `officialPlanPnlPct`/`officialPlanOutcome`), falling back to the
 * same mid columns ONLY when a row predates WS-10 (no `executable` key). feature-store.ts's own
 * comment claims the two "can never disagree" — true only for legacy (pre-WS10) rows, where mid IS
 * the official value; WS-10 exists precisely to make the executable grade ⩽ its mid twin, so a row
 * whose mid P&L is positive but whose executable P&L is ⩽0 flips win→loss under record.ts while
 * feature-store.ts still reads it as a win. This module recomputes both labels from what the
 * `/record` API actually returns (which includes the full `entry_context` per play, and WS-10 stamps
 * the mid grade redundantly INSIDE the executable blob as `mid_plan_outcome`/`mid_plan_pnl_pct` —
 * see scan.ts's `executableBlob` — so the raw mid values ARE recoverable live, no DB access needed).
 */

/**
 * The MID (mechanical) outcome/pnl a ledger row's raw DB columns carry, reconstructed from what
 * `/api/market/zerodte/record` serves for one play. A play's `plan_outcome`/`plan_pnl_pct` fields
 * are already the OFFICIAL (executable-preferred) values (record.ts `toPlay`), so:
 *   - a WS-10-graded row (entry_context.executable present, carrying mid_plan_outcome/mid_plan_pnl_pct)
 *     reads its TRUE raw mid values off that blob;
 *   - a legacy row (no executable blob) has mid === official BY CONSTRUCTION (officialPlanPnlPct /
 *     officialPlanOutcome fall back to the mid columns when no executable blob exists), so the
 *     play's own plan_outcome/plan_pnl_pct fields ARE the mid values.
 * Returns `{ outcome, pnlPct, source }` — `source` is "executable_blob" or "legacy_fallback", purely
 * informative (which rows are even capable of a mid/official split).
 */
export function reconstructMidGrade(play) {
  const ex = play?.entry_context?.executable;
  if (ex && typeof ex === "object" && typeof ex.mid_plan_pnl_pct === "number" && Number.isFinite(ex.mid_plan_pnl_pct)) {
    return {
      outcome: typeof ex.mid_plan_outcome === "string" ? ex.mid_plan_outcome : null,
      pnlPct: ex.mid_plan_pnl_pct,
      source: "executable_blob",
    };
  }
  return {
    outcome: play?.plan_outcome ?? null,
    pnlPct: typeof play?.plan_pnl_pct === "number" ? play.plan_pnl_pct : null,
    source: "legacy_fallback",
  };
}

/**
 * A play is in the OFFICIAL graded population (record.ts `isGradedZeroDteRow`, applied to the
 * fields `/record` already resolved as official) when it carries a non-null, non-"ungradeable"
 * outcome AND a finite pnl. Mirrors record.ts's predicate exactly (it just reads pre-resolved
 * fields instead of re-resolving entry_context, since /record already did that resolution).
 */
export function isOfficialGraded(play) {
  return (
    play?.plan_outcome != null &&
    play.plan_outcome !== "ungradeable" &&
    typeof play?.plan_pnl_pct === "number" &&
    Number.isFinite(play.plan_pnl_pct)
  );
}

/** record.ts `isZeroDteWin`: win iff OFFICIAL pnl > 0. Only meaningful once `isOfficialGraded`. */
export function officialWinLabel(play) {
  return (play?.plan_pnl_pct ?? 0) > 0 ? "win" : "loss";
}

/**
 * Compare one play's two grader views. `labelFromPlanOutcome` is the REAL feature-store.ts
 * function (imported live by the caller — never reimplemented here) applied to the reconstructed
 * mid grade. Returns a verdict object; never mutates input.
 */
export function evaluatePlayAgreement(play, labelFromPlanOutcome) {
  const mid = reconstructMidGrade(play);
  const fsLabel = labelFromPlanOutcome(mid.outcome, mid.pnlPct);
  const officialGraded = isOfficialGraded(play);
  const recordLabel = officialGraded ? officialWinLabel(play) : null;

  const bothGraded = fsLabel != null && recordLabel != null;
  const agree = bothGraded ? fsLabel === recordLabel : null;

  return {
    ticker: play?.ticker ?? null,
    session_date: play?.session_date ?? null,
    mid_source: mid.source,
    mid_outcome: mid.outcome,
    mid_pnl_pct: mid.pnlPct,
    official_outcome: play?.plan_outcome ?? null,
    official_pnl_pct: play?.plan_pnl_pct ?? null,
    feature_store_label: fsLabel,
    record_label: recordLabel,
    both_graded: bothGraded,
    agree,
  };
}
