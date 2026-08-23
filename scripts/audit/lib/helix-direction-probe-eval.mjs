/**
 * Pure helper for scripts/audit/helix-direction-read-probe.mjs — the one thing that probe can
 * legitimately FAIL on.
 *
 * WHY THIS EXISTS. The probe used to exit non-zero on any disagreement between the legacy colour
 * rule and the shipped `readDirection` verdict, justified as *"after the fix the panel USES the
 * shipped verdict, so a disagreement means the deploy does not carry it."*
 *
 * That reasoning does not hold. **Both sides of the comparison are computed inside the probe**,
 * offline, from the same payload — `legacy` is the retired rule reimplemented there
 * (`callPct >= 55`, `net >= 0`) and `shipped` is `readDirection`. Nothing in it observes what the
 * deployed page renders. So a disagreement means only that the two RULES differ on this data,
 * which is the finding the probe exists to measure (#2713: they sign-flip on 44.6% of tickers) and
 * is its own documented headline result. Gating on it guaranteed exit 1 forever — and a gate that
 * can never go green is not a gate. Run at the open it reads as "the deploy does not carry #2713"
 * against a deploy that carries it perfectly well.
 *
 * WHAT IS ACTUALLY FALSIFIABLE from that payload is the shipped rule's own contract:
 * `readDirection` must never state a direction it lacks the coverage for. Below
 * `MIN_READABLE_PCT_FOR_VERDICT` it is required to return `undetermined`. That invariant is GREEN
 * on live data today, and it goes red exactly when something real has broken — the threshold
 * retuned by accident, the gate dropped in a refactor, or a build serving a `readDirection` that
 * predates the coverage gate.
 *
 * The distinction worth carrying: **a check should fail on something that could be otherwise.**
 * A condition that is true by construction is a measurement; only a condition that could be
 * violated is a gate.
 */

/**
 * Rows where the shipped verdict claims a direction the readable share cannot support.
 *
 * `readable_pct == null` is NOT a violation — it means the row carried no premium at all, so
 * nothing was measured. Treating "nothing to read" as "read and violated" is the same
 * absence-as-measurement error this lane keeps correcting.
 */
export function coverageContractViolations(rows, minReadablePct) {
  return (rows ?? []).filter(
    (r) =>
      r &&
      r.shipped_verdict !== "undetermined" &&
      r.readable_pct != null &&
      Number.isFinite(r.readable_pct) &&
      r.readable_pct < minReadablePct
  );
}
