/**
 * Pure helpers for scripts/audit/helix-tape-inventory.mjs — the HELIX tape field-provenance
 * inventory behind docs/audit/HELIX-MAP.md.
 *
 * WHY THESE ARE SPLIT OUT. The harness itself needs live auth and a live tape, so nothing inside
 * it can be unit-tested. The load-bearing part is not the fetch — it is the CLASSIFICATION: which
 * writer produced a row, and what a field's presence/absence actually licenses you to say. Those
 * are pure functions over a row shape, so they are testable against fixed inputs and are kept
 * here, the same split `breakout-cohort-split.mjs` and `grading-agreement-eval.mjs` already use.
 *
 * THE MEASUREMENT THIS EXISTS FOR (live, 2026-08-22, 5000-row/168h member tape). The HELIX tape is
 * written by TWO producers with DIFFERENT payload schemas, and the split is exact — not a
 * distribution, a boundary:
 *
 *   cross-tab event_at x alert_rule -> both 1500 | event_at only 0 | alert_rule only 0 | neither 3500
 *
 *   Group A (1500 rows, 273 tickers): event_at, alert_rule, open_interest, ask_pct,
 *                                     underlying_price, otm_pct — and NO implied_volatility.
 *   Group B (3500 rows, SPX + SPY ONLY): implied_volatility — and NONE of the above.
 *
 * That boundary is why several HELIX numbers cannot be read at face value, and every helper below
 * exists to make one of those readings safe rather than to tidy the harness.
 */

import { contractSizeExact } from "@/features/helix/lib/helix-contract-size";
import {
  signalEligible as productSignalEligible,
  signalEligibility as productSignalEligibility,
} from "@/features/helix/lib/helix-signal-detection";

/** The six keys `executionRouteKey` (src/features/helix/lib/helix-flow-format.ts) scans for, in
 *  its own precedence order. Duplicated ONLY as a reference for the multi-match report below —
 *  the harness imports the real function for actual bucketing and never reimplements it. */
export const ROUTE_KEYS = Object.freeze(["SWEEP", "BLOCK", "SPLIT", "CROSS", "FLOOR", "MULTI"]);

/**
 * Which writer produced this row.
 *
 * DISCRIMINATED ON POSITIVE MARKERS, NOT ON A MISSING TIMESTAMP (corrected 2026-08-23).
 *
 * This used to test `event_at` — present -> A, absent -> B — because on the live tape the two
 * co-varied EXACTLY (1500 both / 0 / 0 / 3500 neither). That was true, and it was still the wrong
 * discriminator: it identified a producer by a field that a PARSE BUG happened to be emptying.
 * When #2723 taught `toIso` to read an epoch, all 3500 index rows gained an `event_at` and this
 * function reclassified every one of them from `B` to `mixed` — so the harness reported
 * "Group B: 0 rows, $0, 0% of all premium" about a population that had not changed at all and
 * still carries ~92% of the tape's premium. A fix landing read as the writer vanishing.
 *
 * Each group is now named by a field only ITS producer writes, so the classification is
 * independent of whether any timestamp parses:
 *   A -> `alert_rule`, sent only by the UW `flow_alerts` channel.
 *   B -> `implied_volatility`, written only by `optionTradePrintToFlowRaw` (the `option_trades`
 *        WS path). Verified against the same 5000-row tape: the IV-carrying set and the
 *        no-alert_rule set are the same 3500 rows.
 *
 * Both markers, or neither, is still reported rather than folded into a group — the clean split is
 * the finding, so the first row that breaks it is the news.
 */
export function writerGroup(row) {
  if (!row || typeof row !== "object") return "unknown";
  const hasRule = row.alert_rule != null && row.alert_rule !== "";
  const hasIv = row.implied_volatility != null && row.implied_volatility !== "";
  if (hasRule && hasIv) return "mixed";
  if (hasRule) return "A";
  if (hasIv) return "B";
  return "unknown";
}

/**
 * Every route key a rule string contains, not just the winning one.
 *
 * `executionRouteKey` returns the FIRST key in its fixed list that appears anywhere in the rule,
 * so a rule naming two mechanisms is silently attributed to whichever the list happens to reach
 * first. Live example: `SweepsFollowedByFloor` matches SWEEP and FLOOR, and is filed as SWEEP.
 * Small today (3 rows), but it is a silent precedence decision no one chose, and it can only be
 * seen by listing ALL matches beside the winner.
 */
export function routeKeyMatches(rule) {
  const r = String(rule ?? "").toUpperCase();
  return ROUTE_KEYS.filter((k) => r.includes(k));
}

/**
 * Are `implied_volatility` units what the SHIPPED renderer assumes?
 *
 * REFRAMED 2026-08-23 — it used to ACCUSE a renderer that no longer exists. `fmtIv` once decided
 * fraction-vs-percent PER ROW (`iv < 3 ? iv * 100 : iv`), and this helper counted the tail that
 * branch misread. #2669 removed the branch — `fmtIv` is now an unconditional `iv * 100` — but this
 * helper kept scoring against the retired rule, so the harness printed
 * `fmtIv misrenders 148 of 3500 rows (4.2%)` about code that is correct. Third false accusation
 * from this one instrument, alongside the two `writerGroup`/`signalEligible` produced.
 *
 * The distribution evidence is KEPT, because it is what justifies the unconditional multiply in the
 * first place: measured live, min 0.07, p25 0.13, median 0.17, p75 0.23, max 106.2 — a single
 * fractional mode with a long right tail, NOT the bimodal shape a mixed-unit feed produces (which
 * would cluster a second lump around 15-30). What changed is the QUESTION. Instead of scoring a
 * dead branch, it now asks whether #2669's assumption still holds, and reports how many rows the
 * shipped renderer would get wrong if it ever stopped holding.
 *
 * So `above_branch` is no longer "rows fmtIv misreads" — it is the upper lump whose APPEARANCE
 * would mean the feed had gone mixed-unit. On a uniformly fractional feed the shipped renderer
 * misrenders NOTHING, and this reports 0 rather than a number that reads like a defect.
 *
 * `verdict` is null — never a guess — below `minSample`.
 */
export function ivUnitVerdict(values, { minSample = 200, branchAt = 3 } = {}) {
  const nums = (values ?? []).filter((v) => typeof v === "number" && Number.isFinite(v) && v > 0)
    .slice().sort((a, b) => a - b);
  const n = nums.length;
  if (n < minSample) {
    return { verdict: null, reason: "insufficient_sample", sample: n, min_sample: minSample };
  }
  const q = (p) => nums[Math.min(n - 1, Math.floor(p * n))];
  const belowBranch = nums.filter((v) => v < branchAt).length;
  const aboveBranch = n - belowBranch;
  const median = q(0.5);
  // A fractional feed sits well under 1 at the median; a percent feed sits in the tens. The tail
  // above the branch is then MISRENDERED, not evidence of a second unit.
  const looksFractional = median < 1;
  return {
    verdict: looksFractional ? "fractional" : "percent_or_mixed",
    sample: n,
    min: nums[0],
    p25: q(0.25),
    median,
    p75: q(0.75),
    max: nums[n - 1],
    below_branch: belowBranch,
    above_branch: aboveBranch,
    /** Does the SHIPPED `fmtIv` — an unconditional `iv * 100` since #2669 — suit this feed? True
     *  exactly when the feed is uniformly fractional. */
    shipped_renderer_ok: looksFractional,
    /** Rows the SHIPPED renderer would get wrong. Zero on a uniformly fractional feed; the
     *  percent-unit lump if the feed ever goes mixed, and every row if it flips outright. */
    misrendered: looksFractional ? 0 : n,
    misrendered_pct: looksFractional ? 0 : 100,
    /** The value separating a fractional body from a percent lump. Retained as the bimodality
     *  probe it always was — NOT as a branch any shipped code still takes. */
    branch_at: branchAt,
  };
}

/**
 * Implied contract count for a print: premium = fill_price x 100 x contracts.
 *
 * The honest test of whether a premium is a premium at all. Written after a $1,307,530,000 SPX
 * print read as an obvious units error and turned out to be arithmetically exact
 * (14,000 x 100 x 933.95). A number being astonishing is not evidence that it is wrong, and this
 * is the cheapest check that separates the two. Returns null when fill is missing or non-positive
 * — an unknown denominator must not become a contract count.
 */
export function impliedContracts(row) {
  // Delegates to the product's own derivation rather than restating it: a harness that computes
  // contracts its own way measures a number nobody ships. The row-shaped signature is kept because
  // that is what the tape rows this walks actually look like.
  return contractSizeExact(row?.premium, row?.fill_price);
}

/**
 * Can this row fire HELIX's two persisted signals?
 *
 * DELEGATES to the product's own `signalEligible` — it does NOT restate the rule. That is the
 * whole correction here (2026-08-23). This used to answer `writerGroup(row) === "A"`, a second,
 * private definition of eligibility that agreed with the detectors only by coincidence: on the
 * pre-#2723 tape "came from the flow_alerts writer" and "has a parseable print time" happened to
 * select the same 1500 rows.
 *
 * #2723 broke the coincidence and the harness kept answering the old question. It reported
 * `eligible 1500/5000 (30%) — the rest can never fire either signal` against a deployed tape where
 * ALL 5000 rows carry a real print time — i.e. it reported the fix as having changed nothing, in
 * the strongest available words ("can never"), on the one instrument §5k of the market-open runbook
 * exists to read. A harness that owns its own copy of a product rule reports on a product nobody
 * ships; this file already refuses that for `executionRouteKey` and `contractSizeExact`, and the
 * refusal now covers eligibility too.
 */
export const signalEligible = productSignalEligible;

/**
 * Share of a population that is signal-eligible, with the counts that produced it — never a bare
 * rate (_COMMON.md #7: a rate without its denominator is not a measurement).
 *
 * Wraps the product's `signalEligibility` and adds only the percentage this harness prints, so the
 * counts and the ineligible-ticker list are byte-identical to what Largo and the member panel are
 * told. `eligible_pct` stays null on an empty population — 0% would assert a measured rate over
 * nothing.
 */
export function signalEligibility(rows) {
  const base = productSignalEligibility(rows ?? []);
  return {
    ...base,
    eligible_pct: base.total > 0 ? Math.round((1000 * base.eligible) / base.total) / 10 : null,
  };
}
