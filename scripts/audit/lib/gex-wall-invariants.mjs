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

/** Coerce to a finite number, else null. Explicit null guard: Number(null) is 0, a real strike. */
function num(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Reduce a `{ strike: netGex }` map to its extremes.
 * Returns nulls when the map is empty or unusable — never invents a wall.
 */
export function wallsFromStrikeTotals(strikeTotals) {
  const rows = Object.entries(strikeTotals || {})
    .map(([k, v]) => [num(k), num(v)])
    .filter(([k, v]) => k != null && v != null);
  if (!rows.length) return { callWall: null, putWall: null, n: 0 };
  let hi = rows[0], lo = rows[0];
  for (const r of rows) {
    if (r[1] > hi[1]) hi = r;
    if (r[1] < lo[1]) lo = r;
  }
  return { callWall: hi[0], putWall: lo[0], n: rows.length };
}

/**
 * Check the served walls against the served strike totals.
 *
 * `definitional` is the real assertion:
 *   'pass'  — both walls equal the argmax/argmin of the totals
 *   'fail'  — at least one does not (swapped, stale, or off a different chain)
 *   'skip'  — no usable strike totals to check against (do NOT call that a failure)
 *
 * `ordering` is reported, never asserted: 'normal' when put < call, 'inverted' otherwise.
 * An inverted book is a real and occasionally-correct market structure.
 */
export function checkWallInvariants({ callWall, putWall, strikeTotals, spot } = {}) {
  const cw = num(callWall);
  const pw = num(putWall);
  const expected = wallsFromStrikeTotals(strikeTotals);

  const ordering = cw != null && pw != null ? (pw < cw ? "normal" : "inverted") : "unknown";

  if (!expected.n) {
    return { definitional: "skip", ordering, expected, reason: "no usable strike_totals in payload" };
  }

  const callOk = cw != null && cw === expected.callWall;
  const putOk = pw != null && pw === expected.putWall;
  const s = num(spot);
  const pct = (w) => (s && s > 0 && w != null ? ((w - s) / s) * 100 : null);

  return {
    definitional: callOk && putOk ? "pass" : "fail",
    ordering,
    expected,
    callOk,
    putOk,
    call_dist_pct: pct(cw),
    put_dist_pct: pct(pw),
    strikes: expected.n,
  };
}
