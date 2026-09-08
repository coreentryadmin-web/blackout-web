import assert from "node:assert/strict";
import { test } from "node:test";
import { fitSpxSignalLogForModel } from "@/lib/largo/spx-signal-log-fit";
import { LARGO_RESULT_CHAR_BUDGET } from "@/lib/largo/fit-tool-result";

test("fitSpxSignalLogForModel caps rows and stays under budget", () => {
  const rows = Array.from({ length: 20 }, (_, i) => ({
    id: i,
    direction: "long",
    thesis: "t".repeat(400),
    headline: "h".repeat(200),
    gates_blocks: [`block ${i}: ${"x".repeat(100)}`],
  }));
  const { fitted } = fitSpxSignalLogForModel(rows);
  assert.ok(fitted.signals.length <= 15);
  assert.equal(fitted.total, 20);
  assert.equal(fitted.truncated, true);
  assert.ok(JSON.stringify(fitted).length <= LARGO_RESULT_CHAR_BUDGET);
});
