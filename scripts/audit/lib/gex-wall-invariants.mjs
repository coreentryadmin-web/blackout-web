// GEX wall invariants — what is ACTUALLY true of call_wall / put_wall, as opposed to what is
// usually true.
//
// WHY THIS EXISTS: data-validator asserted `put_wall < call_wall` as a hard PASS/FAIL. That reads
// like a safety property but it is only a market REGULARITY, and it broke live on 2026-08-14:
// SPX served put_wall 8000 ABOVE call_wall 7800 while spot sat at 7788. Nothing was wrong. At
// 8000 the near-term book was the most-negative-gamma strike in the chain (-2.086e9) even though
// the full-expiry book there was positive (+1.703e9); 7800 was the most positive (+1.075e10).
// `computeGexWalls` returned exactly what it is defined to return.
//
// The check only ever passed because it ran against SPY. Asserting a regularity as an invariant
// produces a confident FAIL on healthy data the first time the market does something normal but
// uncommon — the same failure mode as the ARM "frozen mark" false positive.
//
// What IS invariant is the DEFINITION: the call wall is the strike carrying the most positive net
// GEX, the put wall the most negative, over the same strike totals the payload serves. That is
// checkable against the payload itself, it is strictly stronger than an ordering heuristic (it
// would catch swapped walls, a stale wall, or a wall computed off a different chain — none of
// which the ordering test can see), and it stays true when the structure inverts.
//
// ---------------------------------------------------------------------------------------------
// THE DEFINITION MOVED, AND THIS FILE DID NOT FOLLOW (2026-08-21).
//
// Everything above stayed true, but it stopped describing production. #2417 (2026-08-20) then
// #2521 (2026-08-21) made every wall producer SIDE-CONSTRAINED: a call wall must sit ABOVE spot
// and a put wall BELOW it, because a member reads walls as resistance/support and "resistance at
// 310 while price is 312.66" is an inverted level, not a level. Production derives them with
// `wallsFromStrikeTotals(strikeTotals, spot)` (src/lib/providers/gex-cross-validation-core.ts).
// #2566 aligned the IN-APP verifier (src/lib/correctness/heatmap-verifier.ts INV-3) to match.
// This audit-side copy was missed — it was last touched by #2178 on 2026-08-14, before the
// constraint existed — so it kept asserting the OLD unconstrained global argmax/argmin.
//
// The result was a confident FAIL on healthy data, and specifically an OPEN-SESSION one, because
// the two definitions differ only when the unconstrained extreme sits on the wrong side of spot —
// which happens exactly when spot is sitting near a heavy strike and ticking across it. Measured
// live on SPY 2026-08-21 across the 09:30 ET open (see the PR): spot 765.05 -> agree, spot 764.84
// -> disagree (served 760, unconstrained 765), spot 765.14 -> agree. The flip is a deterministic
// function of spot-vs-strike with a margin of THIRTEEN CENTS, not a timing artifact: it also fails
// when the walls and the totals are read out of ONE payload at ONE instant, where skew is zero by
// construction.
//
// So the constraint below is not a tolerance and not a workaround — it is this file finally
// asserting the definition production actually ships. A consequence worth stating: once both walls
// are side-constrained and non-null, `put < spot < call` holds by construction, so the "inverted"
// ordering that motivated #2178 can no longer arise from constrained walls. It is still reported,
// because it remains reachable when a wall is null or when no spot is available to constrain with.

/** Coerce to a finite number, else null. Explicit null guard: Number(null) is 0, a real strike. */
function num(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** True when `spot` is usable as a side constraint. Mirrors production's own guard exactly. */
export function canConstrain(spot) {
  const s = num(spot);
  return s != null && s > 0;
}

/**
 * Reduce a `{ strike: netGex }` map to its wall extremes.
 *
 * MUST STAY BYTE-FOR-BYTE EQUIVALENT to production's `wallsFromStrikeTotals` in
 * `src/lib/providers/gex-cross-validation-core.ts`. An audit check that derives the expected value
 * by a DIFFERENT rule than the code under test is not a check, it is a second implementation — and
 * the disagreement it reports is its own. That is precisely the bug this file shipped.
 *
 * Two production behaviours are load-bearing and easy to lose in a rewrite:
 *  - the accumulators start at 0, so a call wall needs strictly POSITIVE gamma and a put wall
 *    strictly NEGATIVE. An all-positive book therefore has NO put wall (null), rather than the
 *    least-positive strike;
 *  - when `spot` is supplied there is NO FALLBACK TO THE WRONG SIDE. If nothing qualifies the wall
 *    is null, because "there is no call wall above spot in this book" is a true statement and
 *    inventing one below spot is not.
 *
 * @param strikeTotals `{ strike: netGex }`
 * @param spot When finite and > 0, walls are SIDE-CONSTRAINED (call above spot, put below).
 *             Omit to get the historical unconstrained behaviour — kept so the unit tests can
 *             pin BOTH contracts and show the difference explicitly.
 */
export function wallsFromStrikeTotals(strikeTotals, spot) {
  const constrained = canConstrain(spot);
  const s = num(spot);
  let callWall = null;
  let putWall = null;
  let maxPos = 0;
  let maxNeg = 0;
  let n = 0;
  for (const [strikeStr, gRaw] of Object.entries(strikeTotals || {})) {
    const strike = num(strikeStr);
    const g = num(gRaw);
    if (strike == null || g == null) continue;
    n += 1;
    if (g > maxPos && (!constrained || strike > s)) {
      maxPos = g;
      callWall = strike;
    }
    if (g < maxNeg && (!constrained || strike < s)) {
      maxNeg = g;
      putWall = strike;
    }
  }
  return { callWall, putWall, n };
}

/**
 * Check the served walls against the served strike totals.
 *
 * `definitional` is the real assertion:
 *   'pass'  — both walls equal the constrained argmax/argmin of the totals
 *   'fail'  — at least one does not (swapped, stale, or off a different chain)
 *   'skip'  — cannot be judged: no usable strike totals, or no usable spot to constrain with
 *
 * WHY A MISSING SPOT SKIPS RATHER THAN FALLING BACK TO UNCONSTRAINED: production always had a
 * spot when it picked the wall, so an unconstrained re-derivation is not "the check without the
 * extra information" — it is a check of a rule production does not use, and it fails on healthy
 * data whenever the two rules diverge. Skipping says "this run could not judge it", which is
 * true. Asserting the wrong definition says "this is broken", which is not.
 *
 * `ordering` is reported, never asserted: 'normal' when put < call, 'inverted' otherwise.
 * With side-constrained walls 'inverted' is unreachable while both walls are non-null; it stays
 * meaningful for a null wall and for unconstrained input.
 */
export function checkWallInvariants({ callWall, putWall, strikeTotals, spot } = {}) {
  const cw = num(callWall);
  const pw = num(putWall);
  const s = num(spot);
  const constrained = canConstrain(spot);
  const expected = wallsFromStrikeTotals(strikeTotals, constrained ? s : undefined);

  const ordering = cw != null && pw != null ? (pw < cw ? "normal" : "inverted") : "unknown";
  const pct = (w) => (s && s > 0 && w != null ? ((w - s) / s) * 100 : null);

  if (!expected.n) {
    return { definitional: "skip", ordering, expected, constrained, reason: "no usable strike_totals in payload" };
  }
  if (!constrained) {
    return {
      definitional: "skip",
      ordering,
      expected,
      constrained,
      strikes: expected.n,
      reason: `no usable spot (got ${spot}) — walls are side-constrained since #2417, so they cannot be verified without one`,
    };
  }

  // Strict equality, not a band: both sides are strikes off the SAME served map, so the correct
  // answer is an exact member of that map. A tolerance here would only hide a real mismatch.
  const callOk = cw === expected.callWall;
  const putOk = pw === expected.putWall;

  return {
    definitional: callOk && putOk ? "pass" : "fail",
    ordering,
    expected,
    constrained,
    callOk,
    putOk,
    call_dist_pct: pct(cw),
    put_dist_pct: pct(pw),
    strikes: expected.n,
  };
}
