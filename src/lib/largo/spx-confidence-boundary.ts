/**
 * Strip SPX Slayer's uncalibrated `confidence` before it reaches the model — and separately, note
 * when `score` no longer reconciles with `factors[]` because of clamping (see
 * `scoreClampNoteFor` below; same file because it is the same class of problem: a number Largo
 * receives that does not mean what its own shape implies).
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
 * `score` is `clamp(rawSum, -100, 100)` (`computeSpxConfluence`, `spx-signals.ts`) but the
 * `factors[]` array shown alongside it is built from the SAME unclamped weights and is never
 * re-clamped or re-scaled — on a strong setup the signed sum of `factors[].weight` can run well
 * past ±100 while `score` reads a flat 100/-100, with nothing in the payload saying so. Confirmed
 * on the engine's own golden fixture (`spx-signals.test.ts`): factors sum to 154, `score` reads
 * 100. A member — or Largo — summing the shown factors by hand gets a different number than the
 * score shown, which is exactly the LARGO-PRODUCT-CONTRACT.md "precision" violation: the same fact
 * (why the score is what it is) rendering inconsistently depending on which field you read.
 *
 * Named `score_clamp_note`/`factor_sum_pre_clamp` (not folded into `confidence_omitted`) because
 * this is a DIFFERENT defect from the uncalibrated-confidence one above: `score` itself is a real,
 * bounded measurement (the confluence engine's -100..100 range is intentional and documented), it
 * is only `factors[]` that stops reconciling with it past the bound. Omitting `factors` would cost
 * the model real signal for no reason; noting the discrepancy keeps both.
 */
function scoreClampNoteFor(
  obj: Record<string, unknown>
): { rawSum: number } | null {
  if (typeof obj.score !== "number" || !Array.isArray(obj.factors)) return null;
  let rawSum = 0;
  for (const f of obj.factors) {
    if (f && typeof f === "object" && typeof (f as { weight?: unknown }).weight === "number") {
      rawSum += (f as { weight: number }).weight;
    }
  }
  return rawSum === obj.score ? null : { rawSum };
}

export const SPX_SCORE_CLAMP_NOTE =
  "score is clamped to the confluence engine's -100..100 range; the signed sum of factors[].weight " +
  "below does NOT reconcile with it once a setup is strong enough to hit that bound. " +
  "`factor_sum_pre_clamp` carries the true pre-clamp total — do not treat summing the factors shown " +
  "as a check on `score`, and do not report a hand-summed factor total as the score.";

/**
 * Return `payload` with the uncalibrated confidence value replaced by a named, explanatory absence,
 * AND (independently) a clamp note attached when `score` no longer reconciles with `factors[]`.
 *
 * Passes `null`/`undefined` and non-objects straight through, and leaves a payload that carries
 * NEITHER `rawScore`/`confidence` NOR a clamped score completely untouched — so this is safe to
 * wrap around a tool result whose shape varies (an `{ error }` object, a degraded payload) without
 * inventing a field on it.
 *
 * Triggers on `confidence` alone, not just `rawScore` — a payload can carry the fabricated number
 * under either name. `spx-signal-log.ts`'s `insertSpxSignalLog` persists it as
 * `confidence: play.rawScore` with no `rawScore` key at all, so a guard that required `rawScore`
 * would silently pass every signal-log row through unomitted. This is not hypothetical: the
 * `get_signal_log` Largo tool served exactly that row shape with no omission wrapper at all until
 * this fix — see docs/audit/findings-staging/2026-08-29-spx-signal-log-confidence-leak.md.
 *
 * The clamp note is entirely independent of the confidence strip — it fires whenever `score` is a
 * number and `factors` is an array whose weights sum to something else, regardless of whether the
 * payload also carries `rawScore`/`confidence`. Every known caller of this function
 * (`get_spx_play`, `spx_full_state`, `get_signal_log`, and `sanitizeSpxPlayPayloadForLargo`'s own
 * callers) ships `score`+`factors` together, so this one shared choke point covers all of them.
 */
export function omitUncalibratedSpxConfidence<T>(payload: T): T {
  if (payload == null || typeof payload !== "object" || Array.isArray(payload)) return payload;
  const obj = payload as MaybeConfidence;
  const hasConfidence = "rawScore" in obj || "confidence" in obj;
  const clamp = scoreClampNoteFor(obj);
  if (!hasConfidence && !clamp) return payload;

  let rest: Record<string, unknown>;
  if (hasConfidence) {
    // Policy: per LARGO-PRODUCT-CONTRACT.md, omit confidence when uncalibrated.
    // This field is an arbitrary formula (|score|*1.15 + #factors*3, clamped 0-96)
    // with no measured calibration against outcomes — measured win rate on these plays
    // is ~50% while the field reads constant 96, so fabricated confidence would corrupt
    // cross-product ranking. See FINDINGS 2026-08-23-spx-confidence-uncalibrated.md.
    const { rawScore: _dropped, confidence: _confidenceOmitted, ...r } = obj;
    rest = { ...r, confidence_omitted: SPX_CONFIDENCE_OMITTED };
  } else {
    rest = { ...(obj as Record<string, unknown>) };
  }
  if (clamp) {
    rest = {
      ...rest,
      factor_sum_pre_clamp: clamp.rawSum,
      score_clamp_note: SPX_SCORE_CLAMP_NOTE,
    };
  }
  return rest as unknown as T;
}

export const SPX_UNASSESSED_MEASUREMENT_OMITTED =
  "omitted — no confluence was computed for this payload (`assessed:false`). Grade/score/rawScore " +
  "are placeholder literals (D/0), not measurements. Use headline/thesis/gates for why the desk " +
  "is idle; if an open position exists, read grade from `open_play`.";

type MaybeAssessedPlay = {
  assessed?: boolean;
  grade?: unknown;
  score?: unknown;
  open_play?: { grade?: unknown } | null;
} & Record<string, unknown>;

/**
 * Full Largo sanitizer for SPX play payloads — strips uncalibrated confidence AND suppresses
 * fabricated grade/score when `assessed === false` (matches SpxPlayVerdictBar contract).
 */
export function sanitizeSpxPlayPayloadForLargo<T>(payload: T): T {
  const stripped = omitUncalibratedSpxConfidence(payload);
  if (stripped == null || typeof stripped !== "object" || Array.isArray(stripped)) return stripped;
  const obj = stripped as MaybeAssessedPlay;
  if (obj.assessed !== false) return stripped;

  const openGrade =
    obj.open_play && typeof obj.open_play === "object" && obj.open_play.grade != null
      ? obj.open_play.grade
      : null;

  const { grade: _g, score: _s, ...rest } = obj;
  return {
    ...rest,
    grade: openGrade,
    score: null,
    measurement_omitted: SPX_UNASSESSED_MEASUREMENT_OMITTED,
  } as unknown as T;
}
