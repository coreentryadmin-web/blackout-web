/**
 * Pure aggregation helpers for the 0DTE PRIMARY-GATE-ONLY ablation study
 * (docs/audit/findings-staging/2026-09-09-zerodte-rejection-log-primary-gate-only.md's
 * own closing line: "A restricted version [...] IS buildable today without waiting, and
 * is the planned next step").
 *
 * WHAT "PRIMARY-GATE-ONLY" MEANS AND WHY IT IS A CEILING, NOT A CLEAN MEASUREMENT.
 * `gateRejectionFor` (src/lib/zerodte/gates.ts) persists `gate_failed` as
 * `verdict.blocks[0].code` — the FIRST gate that failed in `evaluateZeroDteGates`'s own
 * evaluation order, never every gate that failed. That evaluation order is fixed and
 * README-documented by the gate function's own comment structure: G-1 (tape alignment)
 * evaluates BEFORE G-12 (confluence floor) and G-13 (flow-accumulation conflict), which
 * both evaluate before G-4 (VIX regime). So a candidate that fails BOTH G-1 and G-12 is
 * persisted with gate_failed="no_market_bias"/"tape_alignment" (G-1) ONLY — G-12 never
 * gets primary credit for that row even though it also would have blocked it. This
 * SYSTEMATICALLY UNDERCOUNTS every gate other than the earliest-evaluated one sharing a
 * failure with it, and by the same token OVERCOUNTS the earliest gate's apparent
 * importance. It is the exact overlap the operator's CTO review asked about — this study
 * answers "what did the FIRST-recorded reason for a block look like in hindsight", not
 * "what would removing gate X alone have changed" (that needs blocks_json, the
 * newly-added FULL-set field, to accumulate a real sample — the finding's "planned next
 * step" this ships).
 *
 * GATE → REJECTION-CODE MAPPING (read directly off gates.ts's own `// G-N —` comments
 * immediately preceding each `blocks.push({ code: ... })`, not inferred):
 *   G-1  (tape/market-bias alignment, index ETF + directional only): "no_market_bias",
 *        "tape_alignment"
 *   G-4  (VIX regime throttle, hard gate since 2026-07-16): "vix_extreme", "vix_elevated",
 *        "vix_unavailable" (directional fail-closed path), "condor_vix_regime" (condor path)
 *   G-10 (intraday structure/VWAP conflict): DEMOTED to score-only on 2026-07-27 (see the
 *        gates.ts comment at that line) — it no longer pushes any block code at all, so it
 *        has NO rejection-log codes and structurally CANNOT be measured this way. This is
 *        reported as NOT_MEASURABLE, never silently skipped or padded with a zero that
 *        could be misread as "G-10 blocks nothing worth keeping".
 *   G-12 (confluence floor, hard gate since 2026-07-24): "confluence_floor"
 *   G-13 (multi-day flow-accumulation conflict, hard gate since 2026-07-30): "flow_accumulation_conflict"
 *
 * "EV" HONESTY (mirrors skip-grading.ts's own non-negotiable rule: "Premium P&L is never
 * fabricated from a stock move"). Rejection rows carry no OCC symbol (the play was
 * blocked before a contract plan ever printed), so the counterfactual grader
 * (skip-grading.ts) can ONLY grade them on the underlying-direction basis — it has no
 * magnitude-correct premium P&L to report, only a discrete would_have_won/would_have_lost
 * verdict. This module therefore reports TWO different numbers under two different
 * names, never blended:
 *   - blocked WIN RATE — the real, measured counterfactual direction-hit rate.
 *   - blocked ASSUMED EV — a MODELED number: the win rate run through the SAME fixed
 *     -50%/+100% payoff PLAN_RULES convention the whole 0DTE ledger already uses for its
 *     own breakeven math (calibration.ts's PRODUCTION_WILSON_FLOOR_PCT = 33.3%, the
 *     breakeven of that exact payoff). It answers "if every blocked play had actually
 *     been tradeable and had graded win/lose exactly as measured, what would the assumed
 *     plan payoff have been" — NOT a reconstruction of what the option premium actually
 *     would have done, which this data cannot support (see skip-grading.ts's own basis
 *     rule). The passed-side EV, by contrast, IS real: record.ts's `mechanical` rollup is
 *     the SAME fixed-plan grade (same PLAN_RULES, same gradePlanFromBars-family walker)
 *     over the COMMITTED ledger, so it is the correct apples-to-apples comparison target
 *     — not the AS-MANAGED headline, which reflects a different (ratchet/trim/thesis)
 *     exit policy the blocked-side counterfactual never applies.
 */

/** Which primary rejection codes belong to each of the operator's five named gates.
 *  G-10 intentionally maps to an EMPTY array — see the module doc above. */
export const GATE_CODE_FAMILIES = {
  "G-1": {
    label: "G-1 · tape/market-bias alignment",
    codes: ["no_market_bias", "tape_alignment"],
  },
  "G-4": {
    label: "G-4 · VIX regime throttle",
    codes: ["vix_extreme", "vix_elevated", "vix_unavailable", "condor_vix_regime"],
  },
  "G-10": {
    label: "G-10 · intraday structure/VWAP conflict",
    codes: [],
  },
  "G-12": {
    label: "G-12 · confluence floor",
    codes: ["confluence_floor"],
  },
  "G-13": {
    label: "G-13 · flow-accumulation conflict",
    codes: ["flow_accumulation_conflict"],
  },
};

/** Wilson score interval for a binomial proportion (k successes in n trials), in
 *  PERCENTAGE points — a direct, dependency-free port of
 *  src/lib/zerodte/calibration-stats.ts's `wilsonInterval` (that file cannot be imported
 *  from a plain .mjs script — CI's tsx ESM loader can't resolve "@/" aliases in dynamic
 *  import positions, the same constraint skip-grading.ts's own module doc states — so the
 *  small, pure formula is ported rather than reimplemented differently). Reference check:
 *  k=8, n=10, z=1.96 → ≈[49.0, 94.3], matching the source file's own pinned test. */
export function wilsonIntervalPct(k, n, z = 1.96) {
  if (!(n > 0)) return { lo: null, hi: null, mid: null };
  const p = k / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denom;
  const margin = (z / denom) * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
  const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
  return { lo: round1(clamp01(center - margin) * 100), hi: round1(clamp01(center + margin) * 100), mid: round1(clamp01(center) * 100) };
}

function round1(v) {
  return Math.round(v * 10) / 10;
}

/** The modeled EV under the fixed -50%/+100% PLAN_RULES payoff, given a win rate in
 *  PERCENTAGE points. NEVER call this "measured premium P&L" — see the module doc. Null
 *  input win rate (no graded rows) returns null, never a fabricated 0. */
export function assumedPlanPayoffEvPct(winRatePct, { winPct = 100, lossPct = -50 } = {}) {
  if (winRatePct == null || !Number.isFinite(winRatePct)) return null;
  const w = winRatePct / 100;
  return round1(w * winPct + (1 - w) * lossPct);
}

/**
 * Merge every BlockedValueLine (src/lib/zerodte/calibration.ts's shape, as served by
 * `GET /api/market/zerodte/calibration`'s `blocked_value` array) whose `gate_failed`
 * matches one of `codes` into ONE combined line for the logical gate. Pure: no IO, no
 * clock. An empty `codes` array (G-10) always returns the NOT_MEASURABLE shape regardless
 * of what `lines` contains — there is structurally nothing to match.
 */
export function aggregateBlockedForGate(lines, codes) {
  if (!Array.isArray(codes) || codes.length === 0) {
    return {
      measurable: false,
      reason: "this gate pushes no rejection-log code (score-only/non-blocking) — zero rows can ever exist to grade",
      n: 0,
      wins: 0,
      ungradeable: 0,
      win_rate_pct: null,
      win_rate_ci_pct: null,
      by_basis: { premium: 0, underlying: 0 },
      matched_codes_present: [],
      ungradeable_reasons: [],
    };
  }
  const codeSet = new Set(codes);
  const matched = (Array.isArray(lines) ? lines : []).filter(
    (l) => l && typeof l.gate_failed === "string" && codeSet.has(l.gate_failed)
  );
  const n = matched.reduce((s, l) => s + (Number(l.n) || 0), 0);
  const wins = matched.reduce((s, l) => s + (Number(l.would_have_won) || 0), 0);
  const ungradeable = matched.reduce((s, l) => s + (Number(l.ungradeable) || 0), 0);
  const premium = matched.reduce((s, l) => s + (Number(l.by_basis?.premium) || 0), 0);
  const underlying = matched.reduce((s, l) => s + (Number(l.by_basis?.underlying) || 0), 0);

  const reasonCounts = new Map();
  for (const l of matched) {
    for (const r of l.ungradeable_reasons ?? []) {
      reasonCounts.set(r.reason, (reasonCounts.get(r.reason) ?? 0) + (Number(r.n) || 0));
    }
  }
  const ungradeable_reasons = Array.from(reasonCounts.entries())
    .map(([reason, count]) => ({ reason, n: count }))
    .sort((a, b) => b.n - a.n || a.reason.localeCompare(b.reason))
    .slice(0, 5);

  return {
    measurable: true,
    reason: matched.length === 0 ? "no rejection rows observed for this gate's codes in the window" : null,
    n,
    wins,
    ungradeable,
    win_rate_pct: n > 0 ? round1((wins / n) * 100) : null,
    win_rate_ci_pct: n > 0 ? wilsonIntervalPct(wins, n) : null,
    by_basis: { premium, underlying },
    matched_codes_present: matched.map((l) => l.gate_failed).sort(),
    ungradeable_reasons,
  };
}

/**
 * Build one comparison row: this gate's aggregated Blocked side (counterfactual,
 * primary-code-only) vs the supplied Passed side (the committed ledger's `mechanical`
 * rollup — the SAME fixed -50/+100/15:50 plan grade the blocked counterfactual uses, see
 * the module doc for why that is the correct comparison target rather than the
 * as-managed headline). `minMeaningfulN` mirrors calibration.ts's own
 * `ENFORCE_MIN_BLOCK_N` graduation floor (10) so this study uses the SAME "is there
 * enough evidence to say anything" bar the rest of the gate-calibration system already
 * applies — it is not a new, made-up threshold.
 */
export function evaluateGatePrimaryAblation({ gateKey, family, blockedValueLines, passed, minMeaningfulN = 10 }) {
  const blocked = aggregateBlockedForGate(blockedValueLines, family.codes);
  const lowN = blocked.measurable && blocked.n < minMeaningfulN;
  const passedWr = passed?.win_rate_pct ?? null;
  const blockedWr = blocked.win_rate_pct;
  const deltaPts = blockedWr != null && passedWr != null ? round1(passedWr - blockedWr) : null;

  let verdict;
  if (!blocked.measurable) verdict = "not_measurable";
  // n=0 is two DIFFERENT facts and must not collapse into one: either the gate's codes
  // never appeared in the rejection log at all (nothing to grade), or they appeared but
  // EVERY one graded ungradeable (e.g. no reconstructable underlying bar) — the second is
  // real rejection volume with a data-availability gap, not an absence of blocks. Reporting
  // both as one "no rejections" line would silently hide that the gate DID fire.
  else if (blocked.n === 0 && blocked.ungradeable > 0) verdict = "all_ungradeable";
  else if (blocked.n === 0) verdict = "no_rejections_in_window";
  else if (lowN) verdict = "low_n";
  else verdict = "measurable";

  return {
    gate: gateKey,
    label: family.label,
    codes: family.codes,
    verdict,
    min_meaningful_n: minMeaningfulN,
    blocked: {
      ...blocked,
      assumed_ev_pct: assumedPlanPayoffEvPct(blocked.win_rate_pct),
    },
    passed: passed ?? null,
    delta_win_rate_pts_passed_minus_blocked: deltaPts,
  };
}

/** Run the whole five-gate table. Pure — `blockedValueLines` and `passed` are already-
 *  fetched data (the caller does the HTTP work); this only aggregates and compares. */
export function evaluateAllGatesPrimaryAblation({ blockedValueLines, passed, minMeaningfulN = 10 }) {
  return Object.entries(GATE_CODE_FAMILIES).map(([gateKey, family]) =>
    evaluateGatePrimaryAblation({ gateKey, family, blockedValueLines, passed, minMeaningfulN })
  );
}

/**
 * Cross-check across EVERY gate code the calibration report knows about (not just the
 * five this study targets) — a self-diagnosing guard so a systemic skip-grading failure
 * never gets misread as "these five gates just happen to have thin/blocked samples".
 * Built after a live run (2026-09-09/10) found ALL 18 gate codes present in a 90-day
 * window reporting n=0 graded with 2000 (the report's own fetch cap) ungradeable rows
 * total — i.e. not a property of the five named gates at all, but of the whole
 * counterfactual grader at that moment. Pure: takes the already-fetched blocked_value
 * array, no IO.
 */
export function platformWideSkipGradingHealth(blockedValueLines) {
  const lines = Array.isArray(blockedValueLines) ? blockedValueLines : [];
  const totalGraded = lines.reduce((s, l) => s + (Number(l.n) || 0), 0);
  const totalUngradeable = lines.reduce((s, l) => s + (Number(l.ungradeable) || 0), 0);
  return {
    total_gate_codes_observed: lines.length,
    total_graded: totalGraded,
    total_ungradeable: totalUngradeable,
    // Every code present ungradeable-only, and there was real volume to grade — the
    // signature of a systemic problem, not four/five quiet gates.
    systemic_zero_graded: lines.length > 0 && totalGraded === 0 && totalUngradeable > 0,
  };
}
