// GEX wall invariants — what is ACTUALLY true of call_wall / put_wall, as opposed to what is
// usually true.
//
// WHY THIS EXISTS: data-validator asserted `put_wall < call_wall` as a hard PASS/FAIL. That reads
// like a safety property but it is only a market REGULARITY, so the check was rewritten (2026-08-14)
// to assert the DEFINITION of a wall instead of its usual ordering — strictly stronger, since it
// catches swapped walls, a stale wall, or a wall computed off a different chain.
//
// WHAT CHANGED (2026-08-21, RTH-caught): the definition itself moved. #2417 and #2521 SIDE-CONSTRAIN
// the served walls against spot — a call wall (resistance) must sit AT/ABOVE spot, a put wall
// (support) AT/BELOW it. "A call wall below spot is not a call wall, it is inverted"; the same holds
// for a put wall above spot. Production's `wallsFromStrikeTotals(totals, spot)` no longer returns the
// raw argmax/argmin — it returns the largest-positive strike ABOVE spot and the largest-negative
// BELOW it (null when none qualifies, never a wall on the wrong side). This checker was still
// computing the UNCONSTRAINED argmax/argmin, so post-#2521 it FALSE-FAILED every correctly
// side-constrained wall (measured live: SPY spot 764.74, served put_wall 760 — the largest negative
// BELOW spot — vs this checker's "expected" 765, the largest negative ANYWHERE, which sits above
// spot). Worse than noisy: a checker whose expectation is the inverted value cannot tell a correct
// wall from a genuinely inverted one, so it was blind to the exact defect #2521 fixed.
//
// THE FIX, and why it is an import not a re-implementation: the wall definition now lives in exactly
// one place — production's `wallsFromStrikeTotals` in gex-cross-validation-core.ts (a zero-import
// pure module). A second copy of the rule here is the same fork that drifted in the first place, so
// the checker IMPORTS the production function and passes spot. Its expectation can no longer diverge
// from what production actually serves.

import { wallsFromStrikeTotals as sideConstrainedWalls } from "../../../src/lib/providers/gex-cross-validation-core.ts";

/** Coerce to a finite number, else null. Explicit null guard: Number(null) is 0, a real strike. */
function num(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Reduce a `{ strike: netGex }` map to its walls, using the SAME side-constrained definition
 * production serves (call wall = largest-positive strike AT/ABOVE spot, put wall = largest-negative
 * AT/BELOW spot). Delegates the extremes to production's `wallsFromStrikeTotals` so the two can
 * never drift; only `n` (the count of usable strikes, for the skip guard) is computed here.
 *
 * `spot` omitted → production's UNCONSTRAINED behaviour (raw argmax/argmin), preserved for callers
 * that genuinely have no quote. The live checker always has spot and passes it.
 * Returns nulls when the map is empty/unusable, or when no strike sits on the correct side of spot —
 * never invents a wall on the wrong side.
 */
export function wallsFromStrikeTotals(strikeTotals, spot) {
  const n = Object.entries(strikeTotals || {})
    .map(([k, v]) => [num(k), num(v)])
    .filter(([k, v]) => k != null && v != null).length;
  if (!n) return { callWall: null, putWall: null, n: 0 };
  const { callWall, putWall } = sideConstrainedWalls(strikeTotals, num(spot) ?? 0);
  return { callWall, putWall, n };
}

/**
 * Check the served walls against the served strike totals, using production's side-constrained
 * wall definition (spot is REQUIRED for the constraint to apply — without it the expectation falls
 * back to the raw argmax/argmin and a genuinely inverted wall would pass).
 *
 * `definitional` is the real assertion:
 *   'pass'  — both walls equal production's side-constrained walls for these totals + spot
 *   'fail'  — at least one does not (swapped, stale, off a different chain, OR served on the wrong
 *             side of spot — an inverted call/put wall, which is now a defect, not a curiosity)
 *   'skip'  — no usable strike totals to check against (do NOT call that a failure)
 *
 * `ordering` is reported, never asserted: 'normal' when put < call, 'inverted' otherwise. The
 * ordering can still legitimately invert (the most-negative BELOW-spot strike can sit above the
 * most-positive ABOVE-spot one); it is the wrong-SIDE-of-spot wall that is the defect, and that is
 * what `definitional` now catches.
 */
export function checkWallInvariants({ callWall, putWall, strikeTotals, spot } = {}) {
  const cw = num(callWall);
  const pw = num(putWall);
  const expected = wallsFromStrikeTotals(strikeTotals, spot);

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
