/**
 * Which earnings event a Meridian UI harness should judge — the COHORT GUARD, shared.
 *
 * WHY THIS EXISTS. Both live Meridian UI harnesses used to click the FIRST earnings row on the
 * timeline, i.e. whichever ticker happened to be next by date. Measured live 2026-08-21, that was
 * `TP`: a low-impact micro-cap with `thermal.available: false`, no options market, and therefore
 * no expected-move band at all. `MeridianMoveRail` renders NOTHING without a band — correctly —
 * so `.mv-rail-track` was absent and `meridian-earnings-ui-audit.mjs` reported the Positioning tab
 * RED on all three viewports for a panel behaving exactly as designed. Three false REDs.
 *
 * On BABA (high impact, same session, same minute) `expected_move_band` is
 * `{spot: 130.3, up: 134.21, down: 126.39}` and the rail paints.
 *
 * This is the same trap `meridian-earnings-data-inventory.mjs` carries `--min-importance` for, and
 * its lesson generalizes past fill rates: **a painted/not-painted verdict without its cohort is not
 * a fact about the panel either.** The options-derived panels are only ever populated for names
 * with a real options market, so judging them against a micro-cap measures the cohort, not the UI.
 *
 * Kept in one place because it was already wrong in two — a second copy is how the two harnesses
 * drift into disagreeing about what they measured.
 */

/** The timeline row for an earnings event, regardless of cohort. */
export const EARNINGS_ROW_BASE = ".meridian-timeline-row.meridian-theme-earnings";

/**
 * The row carries its cohort as a class on `.meridian-timeline-impact` (`impact-high` /
 * `impact-medium` / `impact-low`) — see MeridianTimelineRow.
 */
const IMPACT_TIERS = Object.freeze({
  high: ["impact-high"],
  medium: ["impact-high", "impact-medium"],
  low: [],
});

/** Normalize a `--min-impact` argument; anything unrecognised falls back to the strict default. */
export function normalizeMinImpact(raw) {
  const v = String(raw ?? "high").trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(IMPACT_TIERS, v) ? v : "high";
}

/**
 * A Playwright selector for an earnings row at or above `minImpact`.
 *
 * `low` deliberately yields the unfiltered base selector rather than a `:has(.impact-low)` filter:
 * "at least low" means every row, and matching only the low tier would invert the flag's meaning.
 */
export function earningsRowSelector(minImpact) {
  const tier = IMPACT_TIERS[normalizeMinImpact(minImpact)];
  if (!tier.length) return EARNINGS_ROW_BASE;
  return tier.map((c) => `${EARNINGS_ROW_BASE}:has(.${c})`).join(", ");
}

/** Human-readable cohort label — every result line should carry it. */
export function describeCohort(minImpact) {
  return `impact>=${normalizeMinImpact(minImpact)}`;
}

/**
 * Split HTTP failures into AUTH loss and real product failures.
 *
 * A 401/403 mid-run is this harness losing its session, not the product breaking. CLAUDE.md
 * records that exactly this was mis-read as a product fault THREE times (the thermal validator's
 * sectors, the force-rebuild "IWM 0/5", the Vector board poll) — all long runs, because a run can
 * outlive its ~72s JWT. Reporting it as a P2 also poisons everything downstream: a deep-link that
 * "does not restore the event" is the same 401, counted a second time.
 */
export function splitAuthFailures(badResponses) {
  const auth = [];
  const failures = [];
  for (const r of badResponses ?? []) {
    (/^(401|403)\b/.test(String(r)) ? auth : failures).push(r);
  }
  return { auth, failures };
}
