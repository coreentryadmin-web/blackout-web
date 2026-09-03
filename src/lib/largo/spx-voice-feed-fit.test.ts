import assert from "node:assert/strict";
import { test } from "node:test";
import { fitSpxVoiceFeedForModel } from "@/lib/largo/spx-voice-feed-fit";
import { LARGO_RESULT_CHAR_BUDGET } from "@/lib/largo/fit-tool-result";

test("fitSpxVoiceFeedForModel caps events and stays under budget", () => {
  const events = Array.from({ length: 60 }, (_, i) => ({
    at: Date.now() - i * 1000,
    at_iso: new Date().toISOString(),
    kind: "flip_cross",
    tone: "neutral",
    line: `Event ${i}: ${"x".repeat(180)}`,
    key: `k${i}`,
    session_date: "2026-09-03",
  }));
  const { fitted } = fitSpxVoiceFeedForModel({
    session_date: "2026-09-03",
    events,
  });
  assert.ok(fitted.events.length <= 25);
  assert.equal(fitted.total, 60);
  assert.equal(fitted.truncated, true);
  assert.ok(JSON.stringify(fitted).length <= LARGO_RESULT_CHAR_BUDGET);
});
