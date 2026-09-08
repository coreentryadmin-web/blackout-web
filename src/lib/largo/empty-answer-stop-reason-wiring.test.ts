import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/**
 * L-3 WIRING — the loop reports WHY it stopped; the terminal must pass that through.
 *
 * `anthropicToolLoop` fires `onStop` with a `ToolLoopStopReason` before returning `null`.
 * `emptyAnswerFallback` already classifies on `stopReason` — upstream_error, ai_disabled,
 * spend_ceiling, empty_round, etc. — but if the caller never passes it, every empty turn still
 * falls through to "I couldn't pull enough live data".
 *
 * This is a source tripwire on `largo-terminal.ts`: both call sites must wire onStop → stopReason.
 */
const TERMINAL = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "..", "largo-terminal.ts"),
  "utf8"
);

test("both anthropicToolLoop call sites wire onStop and pass stopReason to emptyAnswerFallback", () => {
  const onStopHooks = TERMINAL.match(/onStop:\s*\(\{\s*reason\s*\}\)\s*=>\s*\{/g) ?? [];
  assert.equal(
    onStopHooks.length,
    2,
    "expected onStop on both non-streaming and streaming loops — empty turns need the loop's reason"
  );

  const stopReasonPasses = TERMINAL.match(/stopReason:\s*loopStopReason/g) ?? [];
  assert.equal(
    stopReasonPasses.length,
    2,
    "expected stopReason passed to emptyAnswerFallback on both paths"
  );
});
