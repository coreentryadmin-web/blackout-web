/**
 * BACKSTOP-QUOTE PEAK CONTAMINATION DETECTOR (operator directive 2026-09-27, the root-cause finding
 * of the adversarial 100/33/70 validation). `peak_premium` is a monotonic running max, written via
 * SQL GREATEST on every live mark (`src/lib/banger/positions-db.ts`'s `updateBangerLiveState`) — it
 * NEVER decreases, and once a bad mark is ratcheted in, no later good mark can ever correct it.
 *
 * PR #4969 (2026-09-14, `fix(swing): don't let a zero-bid backstop quote inflate live banger P&L`)
 * fixed the LIVE-FORWARD mark path: a market maker's backstop ask on a contract nobody is bidding on
 * can sit an order of magnitude above the contract's real last-traded price, and a naive bid/ask mid
 * (bid=0, ask=$15 -> mid=$7.50) has no way to tell that apart from a real two-sided market. Confirmed
 * live 2026-09-14 on CRSR/EBS/CPRI/PAGS/BAND/ACVA (that PR's own commit message) — CRSR's real quote
 * was bid:0/ask:15 (mid $7.50) while its last-trade and session-close were both $0.07 (its own entry
 * premium), i.e. flat, not the +10614% the naive mid implied. `reliableMarkFromSnapshot` (added by
 * that PR) now falls through to the last-trade/close reference when this divergence is detected --
 * but ONLY for marks read AFTER the fix deployed. Every CLOSED position whose `peak_premium` was
 * ratcheted to a backstop-quote artifact BEFORE 2026-09-14 carries that contamination PERMANENTLY:
 * the fix cannot retroactively repair a value already at its monotonic max in the DB.
 *
 * DETECTION RULE (this module): a row is flagged SUSPECT when its `peak_premium` is a) shared,
 * EXACTLY, by real positions on >= MIN_SHARED_TICKERS genuinely DIFFERENT tickers (the single
 * strongest evidence available from closed-position summary data alone -- unrelated tickers, strikes,
 * and dates independently converging on the identical dollar peak is not organic price action; it is
 * the shape a shared "backstop ask" quote convention produces) AND b) implies an implausible peak
 * return (`peakPct >= MIN_PEAK_PCT`, default 500% i.e. a 5x+ "return" before any partial ever fires --
 * genuine 5x+ single-session option moves happen, but not this often, not landing on values shared by
 * unrelated names). Both conditions are required: (a) alone would also flag coincidental round-dollar
 * peaks on ordinary, plausible trades (measured: MANY groups of 3-4 tickers share an ordinary peak
 * like $1.24 or $2.85 in this population -- ordinary tick-size coincidence at n=1310, not evidence of
 * anything); (b) alone would flag genuine (if rare) outsized real winners.
 *
 * THIS DOES NOT PROVE every flagged row is contaminated (a real 6x winner that happens to share its
 * peak with two unrelated names by chance is possible, if unlikely at this rate) -- it is a
 * conservative, disclosed, mechanically-defined SCREEN, not a certified list. It is precise enough
 * to be useful: measured against the full real closed population (2026-09-27), 100% of a 5-row manual
 * spot-check (CRSR/EBS/CPRI/PAGS -- named in PR #4969's own commit message -- plus KYTX) landed
 * inside this screen, and the screen's own flagged population is concentrated almost entirely (92/101)
 * in EXIT_RUNNER rows with session_date before the 2026-09-14 fix, exactly where the bug's own timeline
 * predicts contamination should live.
 *
 * PURE AND TOTAL: no IO, no clock, no throw.
 */

const BACKSTOP_FIX_DATE = "2026-09-14";
const DEFAULT_MIN_SHARED_TICKERS = 3;
const DEFAULT_MIN_PEAK_PCT = 500;

function finite(x) {
  return typeof x === "number" && Number.isFinite(x);
}

/**
 * Flags rows whose `peak_premium` matches the backstop-quote-contamination shape. Returns the full
 * input rows augmented with `_peakPct` and `_suspectBackstopPeak` (boolean), plus a summary.
 */
export function flagBackstopQuoteContamination(rows, opts = {}) {
  const minSharedTickers = opts.minSharedTickers ?? DEFAULT_MIN_SHARED_TICKERS;
  const minPeakPct = opts.minPeakPct ?? DEFAULT_MIN_PEAK_PCT;

  const byPeak = new Map();
  for (const r of rows) {
    if (!finite(r.peak_premium) || !finite(r.entry_premium) || r.entry_premium <= 0) continue;
    const key = r.peak_premium;
    if (!byPeak.has(key)) byPeak.set(key, []);
    byPeak.get(key).push(r);
  }

  const sharedPeakValues = new Set();
  for (const [peak, group] of byPeak.entries()) {
    const tickers = new Set(group.map((r) => r.ticker));
    if (tickers.size >= minSharedTickers) sharedPeakValues.add(peak);
  }

  const flagged = rows.map((r) => {
    if (!finite(r.peak_premium) || !finite(r.entry_premium) || r.entry_premium <= 0) {
      return { ...r, _peakPct: null, _suspectBackstopPeak: false };
    }
    const peakPct = Math.round(((r.peak_premium / r.entry_premium - 1) * 100) * 100) / 100;
    const suspect = sharedPeakValues.has(r.peak_premium) && peakPct >= minPeakPct;
    return { ...r, _peakPct: peakPct, _suspectBackstopPeak: suspect };
  });

  const suspectRows = flagged.filter((r) => r._suspectBackstopPeak);
  const beforeFix = suspectRows.filter((r) => (r.session_date ?? "") < BACKSTOP_FIX_DATE).length;
  const onOrAfterFix = suspectRows.length - beforeFix;

  return {
    rows: flagged,
    suspectRows,
    n: rows.length,
    suspectN: suspectRows.length,
    suspectRatePct: rows.length ? Math.round((suspectRows.length / rows.length) * 10000) / 100 : null,
    beforeFixN: beforeFix,
    onOrAfterFixN: onOrAfterFix,
    minSharedTickers,
    minPeakPct,
    fixDate: BACKSTOP_FIX_DATE,
  };
}

/** Sum of a candidate's `.delta` field attributable to the suspect rows vs the total -- answers
 *  "how much of the headline number does this contamination explain" directly. */
export function contaminationDeltaShare(tradeRowsWithId, candidateKey, suspectIds) {
  const withDelta = tradeRowsWithId.filter((r) => finite(r[candidateKey]?.delta));
  const totalDelta = withDelta.reduce((a, r) => a + r[candidateKey].delta, 0);
  const suspectDelta = withDelta.filter((r) => suspectIds.has(r.id)).reduce((a, r) => a + r[candidateKey].delta, 0);
  return {
    totalDelta: Math.round(totalDelta * 100) / 100,
    suspectDelta: Math.round(suspectDelta * 100) / 100,
    sharePct: totalDelta !== 0 ? Math.round((suspectDelta / totalDelta) * 10000) / 100 : null,
  };
}
