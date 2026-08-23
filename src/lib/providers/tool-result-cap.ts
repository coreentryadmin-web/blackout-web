/**
 * The per-`tool_result` transport cap — and nothing else.
 *
 * WHY ITS OWN MODULE. The constant lived in `providers/anthropic.ts`, which at module scope imports
 * the Anthropic SDK, API telemetry, the Redis cache client, a Discord notifier, and constructs a
 * `SpendTracker`. Reading one number therefore cost a caller that entire graph. `tool-guard.ts` —
 * the one place that measures every tool result's size and so the only place that can DETECT a
 * result heading for this cap — is deliberately kept free of that graph (its own comment: "injected
 * so this module stays free of the 116-tool dependency graph"), so it could not see the number it
 * needed. Splitting the constant out is what lets detection live where the measurement already is.
 *
 * WHAT THE CAP ACTUALLY DOES, stated here because six places in this repo describe it backwards.
 * `anthropicToolLoop` serializes each tool result and, if it is over this many characters, sends
 * `raw.slice(0, MAX_TOOL_RESULT_CHARS) + "…[truncated]"`. It **KEEPS THE HEAD AND DISCARDS THE
 * TAIL**. The phrase "tail slice" used elsewhere means "the tail is cut off", and every current
 * reader reasons correctly from it — `fit-tool-result.ts` puts aggregates FIRST precisely so the cut
 * eats the row sample — but read cold it states the opposite, and a payload designed on the wrong
 * reading puts its aggregates last. That is exactly how `get_zerodte_record` came to deliver 1.5% of
 * itself with every aggregate gone (#2433).
 *
 * An over-cap tool still "succeeds": the call returns, the loop completes, and the model writes a
 * fluent answer from the fragment. Three defects shipped that way (#2433, #2436, #2480) and none was
 * caught by a test — only by asking the live model whether its payload arrived.
 */

/** Per-`tool_result` size cap. Heavy tools (GEX bundles, full flow payloads) are re-sent every loop
 *  round; without a cap they overflow the context window and Anthropic 400s with prompt-too-long
 *  (LARGO-5). Compile-time, NOT env-tunable — changing it requires a deploy. */
export const MAX_TOOL_RESULT_CHARS = 16_000;

/**
 * Would this serialized tool result be cut by the transport?
 *
 * Exact, not approximate: `tool-guard.ts` measures `JSON.stringify(result).length` on the very
 * object the loop then stringifies, so the two numbers are the same string's length. Strictly
 * greater-than, matching the loop's own `raw.length > MAX_TOOL_RESULT_CHARS` — a payload landing
 * exactly on the cap is NOT truncated, and an off-by-one here would report phantom truncations on
 * the tools that sit closest to the limit, which are precisely the ones worth trusting.
 */
export function exceedsToolResultCap(bytes: number): boolean {
  return Number.isFinite(bytes) && bytes > MAX_TOOL_RESULT_CHARS;
}
