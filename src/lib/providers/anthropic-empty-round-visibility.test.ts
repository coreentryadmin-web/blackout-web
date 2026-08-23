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

/** The no-tool-calls branch: `if (!toolCalls.length) { … }` through its terminating return.
 *  The return used to be `return text || null;`. It now discriminates the two outcomes it had been
 *  conflating — text is an ANSWER, no text is an EMPTY ROUND — so the branch reports which, instead
 *  of leaving the caller to guess from a bare `null` and default to "no data". */
const EMPTY_BRANCH =
  /if \(!toolCalls\.length\) \{([\s\S]*?)return text \? stop\("answered", text\) : stop\("empty_round", null\);/;

test("the no-tool-calls branch exists and still returns text-or-null", () => {
  assert.match(SRC, EMPTY_BRANCH, "the tool-loop's no-tool-calls branch has moved or changed shape");
});

test("the branch REPORTS which of the two outcomes it took — the whole point of the split", () => {
  const branch = SRC.match(EMPTY_BRANCH)?.[1] ?? "";
  // The match itself pins the return, but assert the reasons by name so a rename that keeps the
  // shape (e.g. stop("no_text", …)) still fails here rather than silently changing what the member
  // is told. An empty round is NOT a data gap and must never be classified as one again.
  assert.match(SRC, /stop\("empty_round", null\)/, "an empty round must report empty_round");
  assert.match(SRC, /stop\("answered", text\)/, "a tool-less round WITH text is a normal answer");
  void branch;
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
    /surfaces to the member|fallback/i,
    "the operator searching logs for the member-reported string must land here",
  );
  // Scoped to the console.warn CALL, not the whole branch: the branch also carries the historical
  // comment explaining the defect, which quotes the old copy on purpose and must keep doing so.
  // The log used to PROMISE that copy. Once this branch got its own stop reason that became FALSE,
  // and a log line naming the wrong member-facing message sends whoever greps it to the wrong
  // branch — the exact confusion this whole file exists to end.
  const warnCall = branch.match(/console\.warn\(([\s\S]*?)\);/)?.[1] ?? "";
  assert.notEqual(warnCall, "", "the empty-round console.warn call must be findable");
  assert.doesNotMatch(
    warnCall,
    /couldn't pull enough live data/i,
    "stale consequence: an empty round no longer renders the data-gap copy",
  );
  assert.match(warnCall, /empty_round/, "the log must name the stop reason it now reports");
});
