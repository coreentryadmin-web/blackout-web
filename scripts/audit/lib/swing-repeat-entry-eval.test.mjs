import test from "node:test";
import assert from "node:assert/strict";
import { withAttemptSequence } from "./swing-repeat-entry-eval.mjs";

test("withAttemptSequence: a lone position on a ticker/direction is always attempt 1 (1st)", () => {
  const out = withAttemptSequence([{ ticker: "AAPL", direction: "LONG", committedAt: "2026-10-01T00:00:00Z" }]);
  assert.equal(out[0].attemptNumber, 1);
  assert.equal(out[0].attemptLabel, "1st");
});

test("withAttemptSequence: GOOG-shaped repro — 3 LONG entries within the window are 1st/2nd/3rd+", () => {
  // Matches the real #4076 repro: committed 10-12, exited 10-14; committed 10-15, exited 10-16;
  // committed 10-21, exited 10-22 — each re-entry inside 14 days of the prior exit.
  const rows = [
    { ticker: "GOOG", direction: "LONG", committedAt: "2026-10-12T20:37:56Z", exitAt: "2026-10-14T18:45:38Z" },
    { ticker: "GOOG", direction: "LONG", committedAt: "2026-10-15T16:12:12Z", exitAt: "2026-10-16T14:00:43Z" },
    { ticker: "GOOG", direction: "LONG", committedAt: "2026-10-21T19:20:10Z", exitAt: "2026-10-22T14:45:39Z" },
  ];
  const out = withAttemptSequence(rows, { windowDays: 14 });
  assert.deepEqual(out.map((r) => r.attemptLabel), ["1st", "2nd", "3rd+"]);
  assert.deepEqual(out.map((r) => r.attemptNumber), [1, 2, 3]);
});

test("withAttemptSequence: a re-entry AFTER the window has elapsed since the prior exit resets to 1st, not 2nd", () => {
  const rows = [
    { ticker: "NVDA", direction: "LONG", committedAt: "2026-09-01T00:00:00Z", exitAt: "2026-09-03T00:00:00Z" },
    // 30 days after the prior exit — well past a 14-day window — must be a fresh attempt 1.
    { ticker: "NVDA", direction: "LONG", committedAt: "2026-10-03T00:00:00Z", exitAt: "2026-10-05T00:00:00Z" },
  ];
  const out = withAttemptSequence(rows, { windowDays: 14 });
  assert.deepEqual(out.map((r) => r.attemptLabel), ["1st", "1st"]);
});

test("withAttemptSequence: opposite directions on the same ticker are independent sequences, never cross-counted", () => {
  const rows = [
    { ticker: "TSLA", direction: "LONG", committedAt: "2026-10-01T00:00:00Z", exitAt: "2026-10-02T00:00:00Z" },
    { ticker: "TSLA", direction: "SHORT", committedAt: "2026-10-03T00:00:00Z", exitAt: "2026-10-04T00:00:00Z" },
  ];
  const out = withAttemptSequence(rows, { windowDays: 14 });
  assert.deepEqual(out.map((r) => r.attemptLabel), ["1st", "1st"]);
});

test("withAttemptSequence: a different, unrelated ticker never feeds into another ticker's sequence", () => {
  const rows = [
    { ticker: "GOOG", direction: "LONG", committedAt: "2026-10-01T00:00:00Z", exitAt: "2026-10-02T00:00:00Z" },
    { ticker: "META", direction: "LONG", committedAt: "2026-10-03T00:00:00Z", exitAt: "2026-10-04T00:00:00Z" },
  ];
  const out = withAttemptSequence(rows, { windowDays: 14 });
  assert.deepEqual(out.map((r) => r.attemptLabel), ["1st", "1st"]);
});

test("withAttemptSequence: order in the input array doesn't matter — sequencing is by committedAt, not array position", () => {
  const rows = [
    { ticker: "GOOG", direction: "LONG", committedAt: "2026-10-21T19:20:10Z", exitAt: "2026-10-22T14:45:39Z" },
    { ticker: "GOOG", direction: "LONG", committedAt: "2026-10-12T20:37:56Z", exitAt: "2026-10-14T18:45:38Z" },
    { ticker: "GOOG", direction: "LONG", committedAt: "2026-10-15T16:12:12Z", exitAt: "2026-10-16T14:00:43Z" },
  ];
  const out = withAttemptSequence(rows, { windowDays: 14 });
  // out[0] is the row committed 10-21 -> chronologically the 3rd.
  assert.equal(out[0].attemptLabel, "3rd+");
  assert.equal(out[1].attemptLabel, "1st");
  assert.equal(out[2].attemptLabel, "2nd");
});

test("withAttemptSequence: a row missing ticker/direction/a parseable committedAt is dropped from sequencing, never guessed", () => {
  const rows = [
    { ticker: "GOOG", direction: "LONG", committedAt: "not-a-date" },
    { ticker: "", direction: "LONG", committedAt: "2026-10-01T00:00:00Z" },
    { ticker: "GOOG", direction: null, committedAt: "2026-10-01T00:00:00Z" },
  ];
  const out = withAttemptSequence(rows);
  for (const r of out) {
    assert.equal(r.attemptNumber, null);
    assert.equal(r.attemptLabel, null);
  }
});

test("withAttemptSequence: a missing exitAt on an intermediate row doesn't break the gap check for the NEXT row — it just keeps the last KNOWN exit", () => {
  const rows = [
    { ticker: "GOOG", direction: "LONG", committedAt: "2026-10-01T00:00:00Z", exitAt: "2026-10-02T00:00:00Z" },
    // exitAt missing on this row (still-open-looking) — the next row's gap should still measure
    // against row 1's own exitAt, not silently reset to attempt 1 just because row 2 has no exit.
    { ticker: "GOOG", direction: "LONG", committedAt: "2026-10-05T00:00:00Z", exitAt: null },
    { ticker: "GOOG", direction: "LONG", committedAt: "2026-10-08T00:00:00Z", exitAt: "2026-10-09T00:00:00Z" },
  ];
  const out = withAttemptSequence(rows, { windowDays: 14 });
  assert.deepEqual(out.map((r) => r.attemptLabel), ["1st", "2nd", "3rd+"]);
});

test("withAttemptSequence: never mutates the input rows", () => {
  const rows = [{ ticker: "GOOG", direction: "LONG", committedAt: "2026-10-01T00:00:00Z" }];
  withAttemptSequence(rows);
  assert.equal("attemptNumber" in rows[0], false);
});
