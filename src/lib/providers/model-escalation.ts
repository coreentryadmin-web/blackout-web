/**
 * Tool-loop model escalation — pure policy, no SDK, no network.
 *
 * WHY THIS EXISTS. Largo runs every turn on `claude-haiku-4-5`. Haiku is the right default: most
 * member questions are a lookup ("quote on NVDA", "what's the gamma flip") that resolve in one tool
 * call and one synthesis, where the stronger model buys nothing. But Largo's actual product is
 * CROSS-PRODUCT SYNTHESIS — "compare the swing lane to the 0dte lane", "what did the desk get wrong
 * yesterday and why" — and that is exactly where the cheap model is weakest. A constant
 * `LARGO_ESCALATION_MODEL = "claude-sonnet-4-6"` has been declared (and unit-tested) in anthropic.ts
 * since the terminal shipped, with ZERO call sites. This module is the missing wiring.
 *
 * WHY ROUND COUNT, AND NOT A CLASSIFIER. The obvious design is to inspect the question up front and
 * route hard ones to Sonnet. We deliberately do not, because this codebase just deleted exactly that
 * shape: `getToolsForIntent`'s hand-written regexes tried to predict what a question needed and were
 * measured exposing a mean 19% of the tool surface, failing silently on every phrasing nobody had
 * thought of (see FINDINGS 2026-08-10). Predicting difficulty from wording has the same failure
 * mode — "give me your best idea" is five words and is the hardest question on the desk.
 *
 * Round count is not a prediction. It is an OBSERVATION. A question that is still pulling tools at
 * round 3 has already demonstrated it spans products, whatever its wording, and the synthesis that
 * follows is the part worth paying for. Cheap questions self-select out by finishing early and never
 * cost more than they do today.
 *
 * COST, STATED HONESTLY. Prompt caches are keyed by model, so the first escalated round re-writes
 * the ~17k-token tool prefix at Sonnet rates rather than reading it from the Haiku cache. That is a
 * real cost, not a rounding error, and it is the reason the threshold is not 1. Rounds after it hit
 * the Sonnet cache normally, as do later escalated turns in the same session. The existing per-user
 * daily budget, org concurrency ceiling and AI-spend kill switch all still bound the total —
 * escalation changes the price of a turn, never the number of turns.
 */

/** Rounds to run on the base model before escalating. Round indices are 0-based, so the default of
 *  3 means rounds 0,1,2 are Haiku and round 3 onward is Sonnet. Chosen because a lookup resolves in
 *  ~2 rounds (one tool call, one synthesis): a turn still gathering evidence at round 3 has shown it
 *  is not a lookup. Env-overridable so the threshold can be tuned from live data without a deploy. */
export const DEFAULT_ESCALATE_AFTER_ROUNDS = 3;

/** Read the escalation threshold from env, falling back to the default.
 *  Rejects non-numeric, negative and non-integer values rather than coercing them — a typo'd
 *  `LARGO_ESCALATE_AFTER_ROUNDS=three` should leave the tuned default in place, not silently
 *  escalate from round 0 (`Number("three")` is NaN, and every `round >= NaN` is false, which would
 *  instead disable escalation entirely — a silent capability regression rather than a loud one). */
export function escalateAfterRounds(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.LARGO_ESCALATE_AFTER_ROUNDS?.trim();
  if (!raw) return DEFAULT_ESCALATE_AFTER_ROUNDS;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) return DEFAULT_ESCALATE_AFTER_ROUNDS;
  return n;
}

/**
 * The model to use for a given 0-based tool-loop round.
 *
 * Returns `base` unchanged whenever escalation is not configured — no `escalateModel`, or an
 * `escalateModel` equal to the base — so a caller that does not opt in behaves exactly as before.
 * Once `round >= after`, every subsequent round uses `escalateModel`; escalation is a one-way latch
 * within a turn, never oscillating between models mid-conversation (which would thrash the cache on
 * every round AND make the answer's provenance unreadable in the spend ledger).
 */
export function modelForRound(
  round: number,
  base: string,
  escalateModel: string | undefined,
  after: number
): string {
  if (!escalateModel || escalateModel === base) return base;
  if (!Number.isFinite(round) || round < after) return base;
  return escalateModel;
}

/** True when this turn actually escalated — i.e. the loop ran at least one round on the stronger
 *  model. Used for the one-line telemetry that makes escalation rate measurable in production;
 *  without it, "how often does this fire and is the threshold right?" is unanswerable. */
export function didEscalate(roundsUsed: number, escalateModel: string | undefined, after: number): boolean {
  return Boolean(escalateModel) && roundsUsed > after;
}
