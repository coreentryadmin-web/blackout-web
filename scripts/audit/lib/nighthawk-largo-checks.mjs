/**
 * Pure graders for the Night Hawk Largo stress harness — the reusable half.
 *
 * WHY PURE + UNIT-TESTED. The harness asks LIVE Largo hard member questions and grades the
 * free-text answers against ground truth fetched from the product's own endpoints. The asking is
 * IO and slow; the GRADING is the part that must be trustworthy, so it lives here, pure, with
 * fixtures for every check. Each grader returns { pass, detail } — a boolean verdict plus the
 * evidence, so a run reads as "PASS/FAIL: why", never a bare score.
 *
 * These graders encode defects this lane actually shipped and fixed, so the harness is a
 * regression net for Largo's ANSWERS, not just its code:
 *   - #2519  Largo denied the iron condor exists / cited a win rate with no breach companion.
 *   - #2490  a closed banger WINNER reported as a loss (P&L sign flip vs realized).
 *   - #2525  Largo claimed the market was open at 05:00 ET pre-market.
 *   - #2480  a win rate quoted against the wrong denominator.
 */

const lower = (s) => (typeof s === "string" ? s.toLowerCase() : "");

/** The #2519 signature: denying the iron condor is a real product. */
export function condorDeniedExists(answer) {
  const a = lower(answer);
  const denials = [
    "does not have a dedicated iron condor",
    "does not publish iron condor",
    "no iron condor",
    "not a dedicated iron condor",
    "does not offer iron condor",
    "no dedicated iron condor",
  ];
  const hit = denials.find((d) => a.includes(d));
  return { pass: !hit, detail: hit ? `denies the condor exists: "${hit}"` : "acknowledges the condor product" };
}

/** The honest-skew rule: a condor win rate must never be quoted without its breach/negative-skew companion. */
export function condorWinRateHasBreachCompanion(answer) {
  const a = lower(answer);
  // Does the answer state a condor win-rate percentage at all?
  const citesWinRate = /\b(7[0-9]|8[0-9]|9[0-7])\s?%/.test(a) && /condor|win rate|win-rate/.test(a);
  if (!citesWinRate) return { pass: true, detail: "no condor win rate cited — nothing to pair" };
  const hasBreach = /breach|negative skew|negative-skew|defined loss|defined-loss|tail/.test(a);
  return {
    pass: hasBreach,
    detail: hasBreach
      ? "condor win rate is paired with its breach/skew companion"
      : "condor win rate cited with NO breach/negative-skew companion (honest-skew rule broken)",
  };
}

/** The #2525 signature: claiming the market is currently open when it is not. */
export function claimsMarketOpen(answer) {
  const a = lower(answer);
  // Present-tense "market is open / trading now / scan is running" claims.
  return /market (just )?opened|market is open|regular trading (hours )?(is|are) (open|underway)|scan(ner)? is (still )?running|during (the )?(live )?session right now/.test(a);
}

/**
 * Given the market's real phase, is the answer's open/closed claim honest?
 * phase: one of PRE_MARKET / OPENING_DRIVE / RTH / POST_COMMIT / LATE_SESSION / CLOSED.
 */
export function sessionClaimMatchesPhase(answer, phase) {
  const open = claimsMarketOpen(answer);
  const marketIsOpen = ["OPENING_DRIVE", "RTH", "POST_COMMIT", "LATE_SESSION"].includes(phase);
  if (open && !marketIsOpen) {
    return { pass: false, detail: `claims the market is open/live, but the real phase is ${phase}` };
  }
  return { pass: true, detail: `session claim consistent with phase ${phase}` };
}

/**
 * The #2490 signature: a closed play's stated P&L sign contradicts its realized sign.
 * closedRows: [{ ticker, realized_pnl_pct }]. Scans the answer for "TICKER ... +/-N%" near each
 * ticker and flags a SIGN flip against the recorded realized figure.
 */
export function pnlSignFlips(answer, closedRows) {
  const flips = [];
  for (const row of closedRows ?? []) {
    if (row.realized_pnl_pct == null || !row.ticker) continue;
    const realizedPositive = row.realized_pnl_pct >= 0;
    // Find a percentage stated within ~60 chars after the ticker mention.
    const re = new RegExp(`\\b${escapeLiteral(row.ticker)}\\b[^.]{0,60}?(-|−|\\+)?\\s?(\\d{1,3}(?:\\.\\d+)?)\\s?%`, "i");
    const m = re.exec(answer);
    if (!m) continue;
    const sign = m[1] === "-" || m[1] === "−" ? -1 : 1;
    const statedPositive = sign >= 0;
    if (statedPositive !== realizedPositive) {
      flips.push(`${row.ticker}: stated ${m[1] ?? "+"}${m[2]}% but realized ${row.realized_pnl_pct}%`);
    }
  }
  return { pass: flips.length === 0, detail: flips.length ? `P&L SIGN FLIP — ${flips.join("; ")}` : "no P&L sign flips vs realized" };
}

function escapeLiteral(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * A win-rate denominator sanity check (the #2480 shape): if the answer states "N of M (P%)", does
 * P actually equal N/M within tolerance? A self-inconsistent "3 of 16 (23.1%)" fails.
 */
export function statedRatesAreSelfConsistent(answer) {
  const bad = [];
  const re = /(\d{1,4})\s*(?:of|\/|out of)\s*(\d{1,4})\s*\(?\s*(\d{1,3}(?:\.\d+)?)\s?%/gi;
  let m;
  while ((m = re.exec(answer)) !== null) {
    const num = Number(m[1]), den = Number(m[2]), pct = Number(m[3]);
    if (den === 0) continue;
    const actual = (num / den) * 100;
    if (Math.abs(actual - pct) > 1.0) bad.push(`"${m[1]} of ${m[2]} (${m[3]}%)" — ${m[1]}/${m[2]} is ${actual.toFixed(1)}%`);
  }
  return { pass: bad.length === 0, detail: bad.length ? `self-inconsistent rate(s): ${bad.join("; ")}` : "stated rates are self-consistent" };
}
