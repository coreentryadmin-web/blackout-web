// Pure, IO-free evaluators for the 0DTE Night Hawk end-to-end healthcheck
// (scripts/audit/zerodte-e2e-healthcheck.mjs). Split out so the verdict/rollup and
// coherence logic is unit-testable with plain fixtures — no network, no Clerk, no
// Polygon. Every function here is a deterministic function of its inputs.
//
// Verdict vocabulary (ordered worst→best for rollup): RED > AMBER > GREEN > SKIPPED.
//   RED     — a subsystem that should be live is broken / incoherent (gates the run).
//   AMBER   — indeterminate or a legitimate-but-empty state that must NOT read green
//             (e.g. an origin produced zero candidates with a captured gate reason; a
//             mark we couldn't cross-check off-hours). Never fails the run by itself.
//   GREEN   — asserted live, producing, coherent.
//   SKIPPED — not applicable this run (e.g. AWS creds absent for the infra stage).

export const VERDICT_RANK = { RED: 3, AMBER: 2, GREEN: 1, SKIPPED: 0 };

/** Roll a set of sub-verdicts up to the single worst one. Empty / all-SKIPPED → SKIPPED. */
export function rollupVerdict(verdicts) {
  let worst = "SKIPPED";
  for (const v of verdicts) {
    if ((VERDICT_RANK[v] ?? 0) > (VERDICT_RANK[worst] ?? 0)) worst = v;
  }
  return worst;
}

/** A non-skipped RED anywhere means the whole run should exit non-zero. */
export function anyRed(stageVerdicts) {
  return stageVerdicts.some((v) => v === "RED");
}

/**
 * Freshness verdict for a live mark's age.
 *   ageMs == null  → AMBER (age unknown — a sync-lane mark with no per-quote timestamp;
 *                    real, but can't be asserted fresh).
 *   ageMs <= bound → GREEN.
 *   else           → RED (stale beyond the bound while the lane should be live).
 * Off-hours callers pass rth=false and treat staleness as AMBER (the lane idles by design).
 */
export function verdictForStaleness(ageMs, boundMs, rth = true) {
  if (ageMs == null || !Number.isFinite(ageMs)) return "AMBER";
  if (!rth) return ageMs <= boundMs ? "GREEN" : "AMBER";
  return ageMs <= boundMs ? "GREEN" : "RED";
}

/**
 * Split a /marks payload's rows into the populations stage D must judge DIFFERENTLY.
 *
 * The payload (live-marks.ts `getZeroDteLiveMarksFrame`) is a MERGE of two lanes:
 *   - ENTERED ledger plays — a real committed position. These carry `entry_premium` and
 *     are what "LIVE MARKS + P&L" actually means: a missing mark here is a broken
 *     subsystem, and live_pnl_pct is assertable.
 *   - QUOTE-ONLY watch rows — board setup contracts the poller quotes opportunistically
 *     so a card can show a premium. `buildZeroDteLiveMarksPayloadFrom` gives them
 *     `entry_premium: null` → `live_pnl_pct: null` by construction, and they are stamped
 *     `status: "WATCH"` (never CLOSED). A null mark on one of these means "the poller
 *     hasn't quoted this setup", which is the NORMAL state whenever the setup lane is
 *     idle — it is not a P&L failure, because there is no position and no P&L.
 *
 * Splitting on `status !== "CLOSED"` alone conflates the two, so an idle board full of
 * WATCH rows reads as 20+ broken live marks. Split on `entry_premium` — the field that
 * actually distinguishes a position from a quote — not on status.
 */
export function partitionMarkRows(rows) {
  const all = Array.isArray(rows) ? rows.filter((r) => r && typeof r === "object") : [];
  const open = all.filter((r) => r.status !== "CLOSED");
  return {
    entered: open.filter((r) => r.entry_premium != null),
    quoteOnly: open.filter((r) => r.entry_premium == null),
    closed: all.filter((r) => r.status === "CLOSED"),
  };
}

/**
 * Freshness verdict for an ENTERED play's live mark, including the missing-mark case.
 *
 * A null mark during RTH is RED — the lane is supposed to be quoting an open position.
 * Off-hours it is AMBER, for the same reason a stale mark is AMBER off-hours: the lane
 * idles by design once the session ends, so "no mark" is the expected state and must not
 * gate a pre-open run. (Before this existed, stage D hard-coded RED for a null mark and
 * bypassed the rth handling entirely, contradicting its own staleness contract.)
 */
export function verdictForMark(mark, ageMs, boundMs, rth = true) {
  if (mark == null) return rth ? "RED" : "AMBER";
  return verdictForStaleness(ageMs, boundMs, rth);
}

/**
 * Compare a displayed option mark against a Polygon ground-truth mark.
 * Returns { ok, deltaPct } or null when either side is missing/non-positive.
 * `ok` is |Δ| within tolPct of the Polygon value.
 */
export function markAgreement(appMark, polyMark, tolPct) {
  const a = typeof appMark === "string" ? Number(appMark) : appMark;
  const p = typeof polyMark === "string" ? Number(polyMark) : polyMark;
  if (a == null || p == null || !Number.isFinite(a) || !Number.isFinite(p) || p <= 0) return null;
  const deltaPct = (Math.abs(a - p) / p) * 100;
  return { ok: deltaPct <= tolPct, deltaPct };
}

/**
 * Structural validity of a PRICED iron-condor plan (condor.ts CondorPlan) OR the
 * calibration geometry (iron-condor.ts IronCondorLegs). Asserts the real leg ordering
 * an iron condor MUST have — this is the first-class "is the condor actually a condor"
 * geometry check, not a guessed shape.
 *   short_put  <  short_call            (the two shorts straddle the range)
 *   long_put   <  short_put             (put wing is further OTM / below the short put)
 *   short_call <  long_call             (call wing is further OTM / above the short call)
 *   every strike strictly positive
 *   (priced only) net_credit > 0, wing_pts > 0
 * `spot`, when finite, must sit strictly inside the shorts.
 * Returns { valid, reasons[] } — reasons list every violation (empty when valid).
 */
export function condorGeometryCheck(plan, { requireCredit = false } = {}) {
  const reasons = [];
  if (!plan || typeof plan !== "object") return { valid: false, reasons: ["no condor plan/geometry"] };
  const sp = num(plan.short_put);
  const lp = num(plan.long_put);
  const sc = num(plan.short_call);
  const lc = num(plan.long_call);
  for (const [k, v] of [["short_put", sp], ["long_put", lp], ["short_call", sc], ["long_call", lc]]) {
    if (v == null || !Number.isFinite(v)) reasons.push(`${k} missing/non-finite`);
    else if (!(v > 0)) reasons.push(`${k}=${v} not strictly positive`);
  }
  if (sp != null && sc != null && !(sp < sc)) reasons.push(`short_put ${sp} not < short_call ${sc}`);
  if (lp != null && sp != null && !(lp < sp)) reasons.push(`long_put ${lp} not < short_put ${sp} (wing must be further OTM)`);
  if (sc != null && lc != null && !(sc < lc)) reasons.push(`short_call ${sc} not < long_call ${lc} (wing must be further OTM)`);
  const spot = num(plan.spot);
  if (spot != null && Number.isFinite(spot)) {
    if (sp != null && !(sp < spot)) reasons.push(`short_put ${sp} not below spot ${spot}`);
    if (sc != null && !(sc > spot)) reasons.push(`short_call ${sc} not above spot ${spot}`);
  }
  const wing = num(plan.wing_pts);
  if (wing != null && !(wing > 0)) reasons.push(`wing_pts=${wing} not > 0`);
  if (requireCredit) {
    const credit = num(plan.net_credit);
    if (credit == null) reasons.push("net_credit null (no priced credit)");
    else if (!(credit > 0)) reasons.push(`net_credit=${credit} not > 0`);
  }
  return { valid: reasons.length === 0, reasons };
}

/**
 * Track-record arithmetic consistency: wins + losses + breakeven === graded (the SPX
 * 3-way partition, record.ts). Returns { ok, sum, graded }.
 */
export function trackRecordConsistent({ graded, wins, losses, breakeven }) {
  const g = num(graded), w = num(wins), l = num(losses), b = num(breakeven);
  if ([g, w, l, b].some((x) => x == null)) return { ok: false, sum: null, graded: g, reason: "missing count(s)" };
  const sum = w + l + b;
  return { ok: sum === g, sum, graded: g };
}

/**
 * Exit-lifecycle coherence for ONE ledger row (stage E). Asserts the internal
 * consistency the board's own mapLedgerRow guarantees:
 *   - a CLOSED "stopped" row must show the pinned stop P&L (live_pnl_pct === stopPct);
 *   - status must be one of the known lifecycle values;
 *   - a live (OPEN/HOLD/TRIM) row must carry an entry premium to derive P&L from.
 * Returns { ok, reasons[] }.
 */
export function exitLifecycleCoherent(row, { stopPct = -50 } = {}) {
  const reasons = [];
  const KNOWN = new Set(["OPEN", "HOLD", "TRIM", "CLOSED"]);
  const status = row?.status ?? null;
  if (status != null && !KNOWN.has(status)) reasons.push(`unknown status "${status}"`);
  if (row?.closed_reason === "stopped") {
    const pnl = num(row.live_pnl_pct);
    // The board pins a stopped row's P&L to PLAN_RULES.stop_pct exactly; allow a 1pt
    // rounding cushion rather than demanding bit-exactness across roundFloats.
    if (pnl == null || Math.abs(pnl - stopPct) > 1) {
      reasons.push(`stopped row live_pnl_pct=${pnl} != stop ${stopPct}%`);
    }
  }
  if ((status === "OPEN" || status === "HOLD" || status === "TRIM") && num(row?.entry_premium) == null) {
    reasons.push(`live row (${status}) missing entry_premium`);
  }
  // A CLOSED row that isn't "stopped" should still carry a closed_reason label
  // (time_stop or an engine-exit category) — a null there is an incoherent close.
  if (status === "CLOSED" && row?.closed_reason == null) {
    reasons.push("CLOSED row missing closed_reason label");
  }
  return { ok: reasons.length === 0, reasons };
}

/** Does a committed ledger row carry the commit-spine essentials (stage C)? entry
 *  premium, a frozen exit/cortex/tier snapshot (entry_context passthrough), origin-ish
 *  provenance (direction + first_flagged_at). Returns { ok, missing[] }. */
export function commitRowComplete(row) {
  const missing = [];
  if (num(row?.entry_premium) == null) missing.push("entry_premium");
  if (row?.first_flagged_at == null) missing.push("first_flagged_at");
  if (row?.direction == null) missing.push("direction");
  if (num(row?.top_strike) == null) missing.push("top_strike");
  // A frozen decision snapshot: any ONE of cortex / tier is enough evidence the commit
  // pinned its reasoning (pre-wiring legacy rows can lack both — the caller AMBERs those).
  const hasSnapshot = row?.cortex != null || row?.tier != null;
  return { ok: missing.length === 0, missing, hasSnapshot };
}

function num(x) {
  if (x == null) return null;
  const n = typeof x === "string" ? Number(x) : x;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}
