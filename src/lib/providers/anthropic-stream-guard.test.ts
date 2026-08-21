import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/**
 * STREAMING-ROUND ERROR GUARD (#2582).
 *
 * WHY THIS IS A SOURCE ASSERTION rather than a behavioural one: the failure only fires when the
 * Anthropic round itself times out / 429s / errors after retries, which a unit test cannot induce
 * without the real API (the client is acquired internally via `getClient()`, not injected). So the
 * structural fact is what must be locked: BOTH branches of the round call — streaming (`onEvent`)
 * and non-streaming — degrade a round failure to the accumulated-text fallback instead of throwing.
 *
 * The bug this guards: the non-stream branch got the try/catch (#77 hardening E); the stream branch
 * did not. A degraded round on the stream path (the Deep depth uses streaming) threw all the way out
 * of the loop and surfaced the member-facing INTERNAL-ERROR fallback as an HTTP 200, while the same
 * fault on a Concrete turn degraded cleanly. Removing either catch would re-open that asymmetry.
 */

const SRC = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "anthropic.ts"),
  "utf8"
);

/** The one `return extractTextFromLastAssistant(...) ?? null` inside a round-failure `catch`. */
const CATCH_FALLBACK =
  /catch \(err\) \{[\s\S]*?return extractTextFromLastAssistant\(messages as unknown as AnthropicMessage\[\]\) \?\? null;[\s\S]*?\}/g;

test("both the streaming and non-streaming round calls degrade a failure to accumulated text", () => {
  const guards = SRC.match(CATCH_FALLBACK) ?? [];
  // One for the non-stream `messages.create` branch, one for the stream `finalMessage` branch.
  assert.ok(
    guards.length >= 2,
    `expected >=2 round-failure catch→fallback guards (stream + non-stream), found ${guards.length}`
  );
});

test("the streaming branch's finalMessage() is inside a try that catches", () => {
  // finalMessage must be reachable from a catch that returns the accumulated-text fallback — i.e.
  // the stream round is guarded, not naked. Locking the ORDER (finalMessage precedes a catch that
  // returns the fallback) is what distinguishes "guarded" from "a catch elsewhere in the function".
  const streamThenCatch =
    /stream\.finalMessage\(\)[\s\S]*?catch \(err\) \{[\s\S]*?return extractTextFromLastAssistant/;
  assert.match(SRC, streamThenCatch);
});

test("the fix is attributed so the asymmetry is not silently reintroduced", () => {
  assert.match(SRC, /#2582/);
});
