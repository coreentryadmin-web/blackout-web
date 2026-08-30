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

/** Shape-agnostic: `rawScore` (confluence/play shapes) and `confidence` (signal-log rows, which
 *  persist the identical formula under a DIFFERENT key — see spx-signal-log.ts's
 *  `confidence: play.rawScore`) are the same fabricated number under two names. */
type MaybeConfidence = { rawScore?: unknown; confidence?: unknown } & Record<string, unknown>;

/**
 * Return `payload` with the uncalibrated confidence value replaced by a named, explanatory absence.
 *
 * Passes `null`/`undefined` and non-objects straight through, and leaves a payload that carries
 * NEITHER `rawScore` NOR `confidence` completely untouched — so this is safe to wrap around a tool
 * result whose shape varies (an `{ error }` object, a degraded payload) without inventing a field
 * on it.
 *
 * Triggers on `confidence` alone, not just `rawScore` — a payload can carry the fabricated number
 * under either name. `spx-signal-log.ts`'s `insertSpxSignalLog` persists it as
 * `confidence: play.rawScore` with no `rawScore` key at all, so a guard that required `rawScore`
 * would silently pass every signal-log row through unomitted. This is not hypothetical: the
 * `get_signal_log` Largo tool served exactly that row shape with no omission wrapper at all until
 * this fix — see docs/audit/findings-staging/2026-08-29-spx-signal-log-confidence-leak.md.
 */
export function omitUncalibratedSpxConfidence<T>(payload: T): T {
  if (payload == null || typeof payload !== "object" || Array.isArray(payload)) return payload;
  const obj = payload as MaybeConfidence;
  if (!("rawScore" in obj) && !("confidence" in obj)) return payload;
  // Policy: per LARGO-PRODUCT-CONTRACT.md, omit confidence when uncalibrated.
  // This field is an arbitrary formula (|score|*1.15 + #factors*3, clamped 0-96)
  // with no measured calibration against outcomes — measured win rate on these plays
  // is ~50% while the field reads constant 96, so fabricated confidence would corrupt
  // cross-product ranking. See FINDINGS 2026-08-23-spx-confidence-uncalibrated.md.
  const { rawScore: _dropped, confidence: _confidenceOmitted, ...rest } = obj;
  return { ...rest, confidence_omitted: SPX_CONFIDENCE_OMITTED } as unknown as T;
}
