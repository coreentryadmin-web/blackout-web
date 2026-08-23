/**
 * Strip SPX Slayer's uncalibrated `confidence` before it reaches the model.
 *
 * WHAT IS WRONG WITH IT. `computeSpxConfluence` (src/features/spx/lib/spx-signals.ts) ends with:
 *
 *     const confidence = clamp(Math.round(abs * 1.15 + factors.length * 3), 0, 96);
 *
 * That is a deterministic transform of |score| and a COUNT OF FACTORS. It references no realized
 * outcome, has no denominator, and is fitted to no calibration set — yet it is emitted as a
 * percentage and read as one. Two defects sit inside it independent of the calibration question:
 *
 *   1. `factors.length` counts CONFLICTING factors as confidence. `factors` holds both signs, so a
 *      maximally-contradictory tape scoring ~0 across 8 factors still reports 24. The engine
 *      computes `agreeing` and `weighted_conflicts` on the very next lines and uses neither here.
 *   2. Gates never revise it. `confidence` is fixed before `evaluatePlayGates` runs, so a play held
 *      by four gates reports the same conviction as one that passed clean.
 *
 * WHY IT MUST NOT CROSS THIS BOUNDARY. `docs/audit/LARGO-PRODUCT-CONTRACT.md` requires `confidence`
 * be OMITTED when a product cannot calibrate it, "because an invented score is compared against
 * another lane's measured one, so fabricated certainty does not stay local — it corrupts
 * cross-product ranking." Largo ranks SPX Slayer's number against products that measure theirs.
 * Inside the product the field is merely uncalibrated; at this boundary it is actively misleading.
 *
 * WHY OMIT RATHER THAN FIX THE FORMULA HERE. A calibrated replacement has to be built from
 * `spx-play-outcomes` and validated out-of-sample; that is its own piece of work, and shipping a
 * second invented number in the meantime would repeat the mistake. Omission is honest today.
 * See `docs/spx/SLAYER-MAP.md` §7.2.
 *
 * WHY NOT STRIP IT FROM THE ENGINE. The member UI renders it ("{n}% conviction") and that surface
 * is a separate decision with its own blast radius. This module changes only what the MODEL sees.
 *
 * NOT A DEEP STRIP, DELIBERATELY. `confidence` sits at the TOP LEVEL of both shapes (verified
 * across all 12 emission sites in spx-play-engine.ts — always beside available/phase/action/
 * direction/grade/score). A recursive strip would also eat OTHER products' `confidence` where SPX
 * payloads are nested beside them (get_ecosystem_context carries Vector, Thermal and HELIX in the
 * same object), and some of those are calibrated. Removing a peer lane's measured score to fix
 * ours would be the same crime in the other direction.
 */

/** Named so the model cannot read the absence as a missing field or a failed read. */
export const SPX_CONFIDENCE_OMITTED =
  "omitted — SPX Slayer has no calibrated confidence model. The engine's raw value is a formula " +
  "over |score| and a COUNT of contributing factors (conflicting ones included), fitted to no " +
  "outcome data, so it is not a probability and must not be ranked against another product's " +
  "measured confidence. Use `score` (-100..100, signed: positive = long), `grade` (A+..D), and " +
  "`agreeing` vs `weighted_conflicts` to judge conviction instead.";

/** Shape-agnostic: both SpxConfluence and SpxPlayPayload carry `confidence` at the top level. */
type MaybeConfidence = { rawScore?: unknown } & Record<string, unknown>;

/**
 * Return `payload` with the uncalibrated `rawScore` replaced by a named, explanatory absence.
 *
 * Passes `null`/`undefined` and non-objects straight through, and leaves a payload that never
 * carried `rawScore` completely untouched — so this is safe to wrap around a tool result whose
 * shape varies (an `{ error }` object, a degraded payload) without inventing a field on it.
 */
export function omitUncalibratedSpxConfidence<T>(payload: T): T {
  if (payload == null || typeof payload !== "object" || Array.isArray(payload)) return payload;
  const obj = payload as MaybeConfidence;
  if (!("rawScore" in obj)) return payload;
  const { rawScore: _dropped, ...rest } = obj;
  return { ...rest, confidence_omitted: SPX_CONFIDENCE_OMITTED } as unknown as T;
}
