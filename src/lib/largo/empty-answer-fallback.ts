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

export type EmptyAnswerCause = "timeout" | "no_data";

export function classifyEmptyAnswer(input: {
  elapsedMs: number;
  budgetMs: number;
  toolsUsed: readonly string[];
}): EmptyAnswerCause {
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
}): string {
  if (classifyEmptyAnswer(input) === "timeout") {
    const secs = Math.round(input.elapsedMs / 1000);
    return (
      `That took longer than my ${Math.round(input.budgetMs / 1000)}s budget for this answer mode ` +
      `(${secs}s) and I stopped before finishing, so I have nothing reliable to give you rather ` +
      `than a partial read. Ask again — or switch to Concrete, which runs a tighter loop.`
    );
  }
  return "I couldn't pull enough live data to answer that — try naming a ticker or asking about SPX structure.";
}
