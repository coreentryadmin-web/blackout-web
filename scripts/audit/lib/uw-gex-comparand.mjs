/**
 * Pure helper for the audit validator's `net_gex` sign cross-check.
 *
 * WHY THIS FILE EXISTS (FINDINGS 2026-08-06, [P2, tooling]):
 * data-validator.mjs used to ground-truth the app's net_gex against
 * `GET /api/stock/{t}/greek-exposure`. That endpoint is UW's **DAILY HISTORICAL** series —
 * one row per trading DATE (251 rows in the repo's own probe capture,
 * src/lib/docs-probe-report.ts; docs/audit/API-DOCS/uw-rest.md describes it as
 * "Delta/gamma/vega across chain … ticker, date"). `.at(-1)` picked the right row — the
 * array is ascending and the last row IS today — so row selection was never the bug.
 *
 * The bug was the QUANTITY. The app's `net_gex` is an INTRADAY per-1%-move dealer $-gamma
 * (`gamma × oi × 100 × spot² × 0.01`, polygon-options-gex.ts:3525), recomputed every poll.
 * Comparing it to a once-a-day aggregate compares two different things, so their signs
 * legitimately diverge intraday.
 *
 * Measured across the 32 archived validator runs of 2026-08-06:
 *   - the daily comparand took exactly TWO values all session (420277, then 560326)
 *     and was never negative;
 *   - the app's net_gex swung +3.62e9 → −5.62e8 and crossed zero 4 times;
 *   - the check WARNed on exactly the 4 runs where the app's net_gex was < 0 —
 *     i.e. it had degenerated into "is net_gex ≥ 0?", firing on a legitimate
 *     net-short-gamma market state rather than on a data defect.
 *
 * The correct comparand is `GET /api/stock/{t}/spot-exposures` — UW's
 * "Spot GEX exposures per 1min" feed (uw-docs-catalog.ts; 541 rows in the probe capture =
 * a session of minute snapshots). Its `gamma_per_one_percent_move_oi` is the SAME physical
 * quantity in the SAME unit as the app's net_gex, so sign AND magnitude are comparable.
 */

/**
 * Per-1%-move gamma field names UW ships on the spot-exposures product, in preference order.
 * OI first: the app's net_gex is an open-interest-weighted book, so `_oi` is the like-for-like
 * comparand; `_dir`/`_vol` are the directional/volume-weighted siblings and only serve as a
 * fallback so a partial row still yields a check instead of silently skipping it.
 * (Field family confirmed in docs/audit/API-DOCS/websockets.md L128 — the `gex` channel is the
 * streaming face of the same product: `gamma/delta/charm/vanna_per_one_percent_move_{oi,vol,dir}`.)
 */
export const UW_INTRADAY_GAMMA_KEYS = Object.freeze([
  "gamma_per_one_percent_move_oi",
  "gamma_per_one_percent_move_dir",
  "gamma_per_one_percent_move_vol",
]);

const toNum = (x) => {
  // `Number("")` and `Number("   ")` are 0, not NaN — an empty provider field would otherwise
  // become a perfectly plausible-looking zero comparand and the check would compare against a
  // number that was never sent. Reject blank strings explicitly.
  if (typeof x === "string" && x.trim() === "") return null;
  const n = typeof x === "string" ? Number(x) : x;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
};

/**
 * Pick the freshest intraday dealer $-gamma from a UW `/spot-exposures` payload.
 *
 * Returns one of:
 *   { ok: true,  key, value, time }        — usable comparand
 *   { ok: false, reason: 'no-data' }       — payload had no data[] rows
 *   { ok: false, reason: 'no-gamma-field', keysSeen } — rows exist but carry none of the
 *                                            known gamma keys (a provider rename: report it
 *                                            as INFO, never fabricate a comparison)
 *
 * `.at(-1)` is deliberate and correct here for the SAME reason it was correct on the daily
 * series: UW returns these time series ASCENDING, so the last row is the most recent minute.
 *
 * @param {unknown} payload raw JSON from GET /api/stock/{ticker}/spot-exposures
 */
export function pickUwIntradayGamma(payload) {
  const rows = payload && typeof payload === "object" ? payload.data : null;
  if (!Array.isArray(rows) || rows.length === 0) return { ok: false, reason: "no-data" };
  const row = rows.at(-1);
  if (!row || typeof row !== "object" || Array.isArray(row)) return { ok: false, reason: "no-data" };
  for (const key of UW_INTRADAY_GAMMA_KEYS) {
    // Own-property check: these keys never live on Object.prototype, but reading a provider
    // payload with a bare member access is the kind of thing that quietly resolves an inherited
    // member on a hand-built fixture. Be explicit.
    if (!Object.prototype.hasOwnProperty.call(row, key)) continue;
    const value = toNum(row[key]);
    if (value != null) return { ok: true, key, value, time: row.time ?? row.timestamp ?? row.date ?? null };
  }
  return { ok: false, reason: "no-gamma-field", keysSeen: Object.keys(row).slice(0, 12).join(",") };
}

/**
 * Verdict for the net_gex sign cross-check.
 *
 * Same quantity + same unit means the MAGNITUDE ratio is meaningful too, so it is reported
 * alongside the sign. Sign disagreement stays a WARN (not FAIL): the app's book is
 * Polygon-chain-derived and UW's is their own, so a genuine near-zero straddle can flip one
 * side without either being wrong — but with a like-for-like comparand it is now a real signal
 * instead of a daily-vs-intraday artifact.
 *
 * @param {number|null} appNetGex
 * @param {ReturnType<typeof pickUwIntradayGamma>} picked
 */
export function netGexSignVerdict(appNetGex, picked) {
  if (appNetGex == null || !Number.isFinite(appNetGex)) {
    return { status: "INFO", detail: "skipped — app net_gex absent" };
  }
  if (!picked?.ok) {
    return picked?.reason === "no-gamma-field"
      ? {
          status: "INFO",
          detail: `skipped — UW spot-exposures row carried none of ${UW_INTRADAY_GAMMA_KEYS.join("/")} (keys: ${picked.keysSeen})`,
        }
      : { status: "INFO", detail: "skipped — UW spot-exposures returned no rows" };
  }
  const agrees = appNetGex >= 0 === picked.value >= 0;
  const ratio = picked.value !== 0 ? appNetGex / picked.value : null;
  return {
    status: agrees ? "PASS" : "WARN",
    detail: `app=${appNetGex} uw.${picked.key}=${picked.value.toExponential(3)}${
      picked.time ? ` @${picked.time}` : ""
    } ratio=${ratio == null ? "n/a" : `${ratio.toFixed(2)}×`} (same per-1%-move $-gamma scale)`,
  };
}
