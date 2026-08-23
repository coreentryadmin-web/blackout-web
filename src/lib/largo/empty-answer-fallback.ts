/**
 * What to say when the tool loop produced no answer.
 *
 * THE MESSAGE USED TO BLAME THE DATA FOR A TIMEOUT.
 *
 * Both call sites in largo-terminal.ts fell back to a single string:
 *
 *   "I couldn't pull enough live data to answer that — try naming a ticker or asking about SPX
 *    structure."
 *
 * Measured on prod 2026-08-20, three turns in one eight-question adversarial run came back with
 * exactly that text:
 *
 *   sunday/deep     81.7s
 *   dte3/deep       89.8s
 *   macro/concrete  21.3s
 *
 * Deep dive's budget is 75s. Those turns did not lack data — they ran out of TIME, and the member
 * was told the desk had no data and advised to "try naming a ticker" on a question that already
 * named SPX. Following that advice cannot help, because the advice addresses a cause that was not
 * the cause.
 *
 * That is the same failure shape as the vanna fabricated negative: an honest-SOUNDING explanation
 * attached to the wrong reason. A member cannot distinguish "we have no data on this" from "this
 * took too long", and only one of those means try again.
 *
 * Pure and total: no IO, no throw.
 */

// TYPE-ONLY, so this module stays pure — `import type` is erased by the compiler and pulls no
// Anthropic SDK, no IO, nothing at runtime.
//
// DECLARED ONCE, ON PURPOSE. The first draft of this fix wrote the union out a second time here and
// guarded the copies with a type-level assertion in the test file. That guard was INERT: tsconfig
// excludes `**/*.test.ts`, so `tsc` never checked it — verified by drifting one union deliberately
// and watching the build stay green. Two hand-kept lists with a guard that cannot fire is worse
// than no guard, so the duplicate is gone instead: the loop owns the union, this module imports it,
// and a new member is a compile error in `classifyEmptyAnswer` rather than a silent fall-through
// to "no_data" — which is the exact defect this file exists to prevent.
import type { ToolLoopStopReason } from "@/lib/providers/anthropic";

export type EmptyAnswerCause =
  | "budget_ceiling"
  | "timeout"
  | "no_data"
  /** The AI provider rejected or failed the request. Ours to own, never the data's fault. */
  | "provider_error"
  /** Claude is disabled or unconfigured in this environment. */
  | "unavailable"
  /** The model returned a round with no tool calls and no text. */
  | "empty_round";

/**
 * The loop's own account of why it stopped, when the caller asked for one.
 *
 * THIS IS THE FIX FOR THE DEFECT THIS FILE WAS ALREADY HALF-FIXING. The header above records a
 * TIMEOUT being narrated as a data gap. The same shape, worse: on 2026-08-22 every Anthropic call
 * was failing with HTTP 400 *"Your credit balance is too low to access the Anthropic API"*, and for
 * a day Largo answered *"I couldn't pull enough live data"* — a billing failure dressed as a data
 * gap. The elapsed-time heuristic below cannot see any of that, because by the time it runs the
 * only thing left is a `null`. So the loop now says which of its exits it took, and a stated reason
 * OUTRANKS the heuristic — a guess must never overrule a fact.
 *
 * Optional on purpose: with no reason supplied the classification is byte-identical to before.
 */
export type LoopStopReason = ToolLoopStopReason;

export function classifyEmptyAnswer(input: {
  elapsedMs: number;
  budgetMs: number;
  toolsUsed: readonly string[];
  /** What the tool loop reported. Beats every heuristic below when present. */
  stopReason?: LoopStopReason;
  /** The daily AI-spend ceiling is CURRENTLY tripped. Highest precedence: a paused desk has a
   *  cause the member can act on ("come back after the ET reset"), and it must never be dressed up
   *  as a data gap OR a timeout. The route's pre-flight gate returns an honest 503, but the ledger
   *  can cross the ceiling AFTER that check passes (spend accrues every round, across replicas), so
   *  the loop stops on the ceiling and returns null — this is the caller re-reading that state so
   *  the empty answer names the real reason. See anthropic.ts::isAiSpendCeilingTripped. */
  ceilingTripped?: boolean;
}): EmptyAnswerCause {
  // A REPORTED CAUSE BEATS AN INFERRED ONE, always. The checks below infer from elapsed time and a
  // default; those are what to do when nobody told us, not what to do instead of being told.
  switch (input.stopReason) {
    case "spend_ceiling":
      return "budget_ceiling";
    case "upstream_error":
      return "provider_error";
    case "ai_disabled":
    case "not_configured":
      return "unavailable";
    case "empty_round":
      return "empty_round";
    case "loop_budget":
      return "timeout";
    // "answered" and "max_rounds" carry no better information than the heuristics do —
    // `max_rounds` with nothing to show really is a data-shaped failure — so they fall through.
    default:
      break;
  }
  if (input.ceilingTripped) return "budget_ceiling";
  // 85% of budget: a loop killed at its deadline rarely reports the deadline exactly, and the
  // margin matters more than the precision — misreading a timeout as "no data" sends the member
  // down a road that cannot help, while the reverse merely suggests retrying.
  if (input.budgetMs > 0 && input.elapsedMs >= input.budgetMs * 0.85) return "timeout";
  // Tools ran and still produced nothing to say — genuinely a data gap.
  return "no_data";
}

export function emptyAnswerFallback(input: {
  elapsedMs: number;
  budgetMs: number;
  toolsUsed: readonly string[];
  ceilingTripped?: boolean;
  stopReason?: LoopStopReason;
}): string {
  const cause = classifyEmptyAnswer(input);
  if (cause === "provider_error") {
    // DELIBERATELY NAMES NO DETAIL. The provider message can read "your credit balance is too low",
    // which is our billing state and not a member's business — it is logged server-side instead
    // (anthropic.ts logs it verbatim on the same failure). What the member needs is the one thing
    // the old copy got wrong: this is NOT a gap in the data, so re-asking with a ticker cannot
    // help and re-asking later can.
    return (
      "I couldn't complete this answer — the AI provider rejected the request. That's a platform " +
      "problem on our side, not a gap in the desk's data, and it's been logged. Try again shortly."
    );
  }
  if (cause === "unavailable") {
    return (
      "Largo's AI engine isn't available in this environment right now. That's a configuration " +
      "issue on our side, not a gap in the desk's data."
    );
  }
  if (cause === "empty_round") {
    // NO MACHINERY NOUNS. The first draft said "the model came back empty — it didn't call a single
    // desk tool", which is precise and means nothing to a member; `never-narrate-machinery.test.ts`
    // exists because exactly that vocabulary reached member prose once already ("the Meridian
    // prefetch already has the week's event board loaded"). That rule polices the system prompt, but
    // the honesty it protects applies just as much to copy written in code. What survives is the
    // only part a reader can act on: nothing came back, and the data is not why.
    return (
      "This turn came back empty — nothing was pulled and nothing was written up. That isn't a gap " +
      "in the desk's data. Ask again, or narrow it to one ticker or one desk."
    );
  }
  if (cause === "budget_ceiling") {
    // Mirrors the route's pre-flight 503 (route.ts) so a member sees ONE consistent message whether
    // the ceiling was already tripped at the gate or crossed mid-request.
    return "Largo is temporarily paused: the platform-wide daily AI spend limit has been reached. Try again after midnight ET.";
  }
  if (cause === "timeout") {
    const secs = Math.round(input.elapsedMs / 1000);
    return (
      `That took longer than my ${Math.round(input.budgetMs / 1000)}s budget for this answer mode ` +
      `(${secs}s) and I stopped before finishing, so I have nothing reliable to give you rather ` +
      `than a partial read. Ask again — or switch to Concrete, which runs a tighter loop.`
    );
  }
  return "I couldn't pull enough live data to answer that — try naming a ticker or asking about SPX structure.";
}
