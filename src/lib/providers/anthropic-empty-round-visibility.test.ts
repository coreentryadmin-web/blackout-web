import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/**
 * EMPTY-ROUND VISIBILITY.
 *
 * A tool-loop round that returns NO tool calls and NO text makes `anthropicToolLoop` return
 * `null`, and the caller renders that as *"I couldn't pull enough live data to answer that"* — a
 * data excuse for something that is not a data problem. On 2026-08-21/22 members were served that
 * string for a day while the matrix cache was warm and the underlying endpoints returned 200 with
 * fresh values (`gex-positioning?ticker=SPY` → `available:true, gamma_posture "short"` in the same
 * minute Largo declined).
 *
 * It took a day and three wrong causes to get nowhere, because from outside the loop the two
 * possibilities are indistinguishable and BOTH look identical in the persisted turn:
 *   - the model returned no `tool_use` block at all — upstream behaviour, nothing to fix here
 *   - the model asked for a tool and we dropped it — ours, and severe
 * `persistClaudeTurn` writes only the final answer and `tools_used`, so the turn row keeps no
 * per-round record. Three independent harnesses each reproduced the symptom; none could tell those
 * apart.
 *
 * WHY THIS IS A SOURCE ASSERTION rather than a behavioural one — the same reason as
 * `anthropic-stream-guard.test.ts`: inducing an empty round needs the real API, since the client is
 * acquired internally via `getClient()` and is not injected. So what gets locked is the structural
 * fact: the empty-round branch LOGS before returning.
 *
 * WHY THE NARROWNESS IS PART OF THE CONTRACT: a tool-less round WITH text is the normal way a turn
 * ends. Logging those would bury the one line that matters under every healthy turn, and a signal
 * nobody can find is the same as no signal. The guard therefore asserts the log is conditioned on
 * the text being empty — widening it later would silently destroy the thing it was added for.
 */

const SRC = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "anthropic.ts"), "utf8");

/** The no-tool-calls branch: `if (!toolCalls.length) { … }` through its `return text || null;`. */
const EMPTY_BRANCH = /if \(!toolCalls\.length\) \{([\s\S]*?)return text \|\| null;/;

test("the no-tool-calls branch exists and still returns text-or-null", () => {
  assert.match(SRC, EMPTY_BRANCH, "the tool-loop's no-tool-calls branch has moved or changed shape");
});

test("an empty round (no tool calls AND no text) is logged before returning null", () => {
  const branch = SRC.match(EMPTY_BRANCH)?.[1] ?? "";
  assert.match(
    branch,
    /console\.(warn|error)\(/,
    "the empty-round path must log — without it, a member-facing wrong answer leaves no trace at the only point where its cause is still visible",
  );
});

test("the log is conditioned on EMPTY text, not fired on every tool-less round", () => {
  const branch = SRC.match(EMPTY_BRANCH)?.[1] ?? "";
  assert.match(
    branch,
    /if \(!text\)/,
    "a tool-less round WITH text is a normal turn ending; logging those buries the signal",
  );
});

test("the log records the round's SHAPE, which is what distinguishes the two causes", () => {
  const branch = SRC.match(EMPTY_BRANCH)?.[1] ?? "";
  // Round index and the block-type list are the discriminating facts: "round 0, blocks=0[]" is a
  // model that returned nothing; a non-empty block list with no tool_use is a different story.
  assert.match(branch, /round/, "the round index must be recorded");
  assert.match(branch, /blocks=|kinds/, "the returned block types must be recorded");
});

test("the log names the member-visible consequence, so a reader connects it to the report", () => {
  const branch = SRC.match(EMPTY_BRANCH)?.[1] ?? "";
  assert.match(
    branch,
    /couldn't pull enough live data|fallback/i,
    "the operator searching logs for the member-reported string must land here",
  );
});
