/**
 * SPX confluence — trade-manager narrative synthesis.
 *
 * `get_spx_confluence` (run-tool.ts) returns pure structured JSON — action/bias/score/grade/
 * agreeing/weighted_conflicts — with NO connected-prose synthesis layer, unlike Night Hawk
 * Swings' mature `tradeManagerNarrativeSection` (src/lib/swing/play-brief-narrative.ts), which
 * turns the same class of scored/gated fields into a few connected "trade-manager voice"
 * sentences instead of a bullet dump. Flagged as a real gap on PR #4076 (comment 5749157602,
 * 2026-09-20) with no narrative layer anywhere in SPX Slayer's Largo-facing tools.
 *
 * THIS IS THE SMALLEST FIRST STEP, deliberately not a port of swing's whole narrative stack: one
 * pure function that synthesizes the fields `get_spx_confluence` ALREADY computes (action, bias,
 * score, grade, agreeing, weighted_conflicts, direction) into 2-4 connected sentences, wired into
 * the existing tool response as an ADDITIVE `narrative` field. Per
 * `docs/audit/LARGO-PRODUCT-CONTRACT.md`'s additive principle — `ProductRead<T>` WRAPS a
 * product's own `T`, flattening/replacing is a violation — every structured field this function
 * reads stays exactly where it was; `narrative` is new, nothing existing changes shape.
 *
 * WHAT IT DELIBERATELY DOES NOT DO (real follow-ups, not this PR's scope). No dealer-posture /
 * dark-pool / GEX-king synthesis — that needs the full desk (`desk.gex_walls`, `desk.spx_flows`),
 * not just the confluence output. No counter-thesis or cross-desk coaching — swing's
 * `play-brief-narrative-coaching.ts` is a much larger, position-lifecycle-aware system built over
 * many PRs; a single-tool synthesis here should not try to reproduce it in one shot.
 *
 * NEVER FABRICATES CONFIDENCE. `confidence`/`rawScore` are already stripped upstream by
 * `omitUncalibratedSpxConfidence` (spx-confidence-boundary.ts) before this ever runs — this
 * module reads only `score`/`grade`/`agreeing`/`weighted_conflicts`, real bounded measurements,
 * and never invents a probability. When the desk hasn't computed a confluence at all (an
 * `{ error }` payload, or any shape missing the core scalar fields), returns `null` rather than
 * narrating an absence as if it were a real read — the LARGO-PRODUCT-CONTRACT.md absence
 * principle.
 */

/** Shape-agnostic on purpose — this runs on the FITTED tool-result payload (post
 *  `fitSpxPlayForModel`/`omitUncalibratedSpxConfidence`), not directly on `SpxConfluence`, so it
 *  must not assume every field survived unclamped/untrimmed. */
type ConfluenceLike = Record<string, unknown>;

type NarratableConfluence = {
  action: string;
  bias: string;
  score: number;
  grade: string;
  agreeing: number | null;
  conflicts: number | null;
  weighted_conflicts: number | null;
  direction: string | null;
  confidenceOmitted: boolean;
};

function fin(n: unknown): number | null {
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

function asNarratable(payload: ConfluenceLike): NarratableConfluence | null {
  const { action, bias, score, grade } = payload;
  if (
    typeof action !== "string" ||
    typeof bias !== "string" ||
    typeof score !== "number" ||
    !Number.isFinite(score) ||
    typeof grade !== "string"
  ) {
    return null;
  }
  const direction = payload.direction;
  return {
    action,
    bias,
    score,
    grade,
    agreeing: fin(payload.agreeing),
    conflicts: fin(payload.conflicts),
    weighted_conflicts: fin(payload.weighted_conflicts),
    direction: direction === "long" || direction === "short" ? direction : null,
    confidenceOmitted: "confidence_omitted" in payload,
  };
}

const ACTION_VERB: Record<string, string> = {
  BUY_CALL: "leans toward buying calls",
  BUY_PUT: "leans toward buying puts",
  HOLD: "is holding, not adding fresh risk",
  WAIT: "is waiting for a cleaner setup",
};

function biasClause(bias: string): string {
  if (bias === "bullish") return "a bullish read";
  if (bias === "bearish") return "a bearish read";
  return "no clear directional lean";
}

/**
 * Synthesize `get_spx_confluence`'s structured fields into 2-4 connected trade-manager-voice
 * sentences. Pure, deterministic, no LLM — same discipline as swing's narrative helpers. Returns
 * `null` when the payload isn't a real confluence read (e.g. an `{ error }` shape), so a caller
 * never has to guess whether an empty string means "nothing to say" or "narration failed".
 */
export function spxConfluenceNarrative(payload: ConfluenceLike): string | null {
  const c = asNarratable(payload);
  if (!c) return null;

  const verb = ACTION_VERB[c.action] ?? `is at ${c.action}`;
  const sentences: string[] = [];

  // Sentence 1 — what the desk is doing and why, action + score + bias + grade fused into one
  // connected clause instead of four separate fields a reader has to reconcile by hand.
  sentences.push(`The desk ${verb} — confluence score ${c.score} (${biasClause(c.bias)}), grading ${c.grade}.`);

  // Sentence 2 — the evidence weight behind that grade: agreeing vs conflicting factors, weighted
  // by conviction rather than a bare count, so "grade A on a clean read" and "grade A despite real
  // disagreement" don't read identically.
  if (c.agreeing != null) {
    const agreeWord = `${c.agreeing} factor${c.agreeing === 1 ? "" : "s"}`;
    if (!c.conflicts) {
      sentences.push(`${agreeWord} agree, with no conflicting factors.`);
    } else {
      const weightNote =
        c.weighted_conflicts != null && c.weighted_conflicts > 0
          ? ` (weighted conflict ${c.weighted_conflicts.toFixed(1)}) — real disagreement, not a clean read`
          : "";
      sentences.push(`${agreeWord} agree against ${c.conflicts} conflicting${weightNote}.`);
    }
  }

  // Sentence 3 — direction, only when the engine actually names one; bias and direction can
  // legitimately diverge (spx-signals.ts), so this never infers direction from bias.
  if (c.direction) {
    sentences.push(`Direction: ${c.direction}.`);
  }

  // Sentence 4 — honesty about the missing confidence number, so the narrative never reads as
  // more certain than the desk's own contract allows. Doesn't repeat the full explanatory text
  // already carried verbatim in `confidence_omitted` — just orients the reader to what to use
  // instead.
  if (c.confidenceOmitted) {
    sentences.push(
      "No calibrated confidence is available for this read — judge conviction from grade and the factor split above, not a percentage."
    );
  }

  return sentences.join(" ");
}
