import { test } from "node:test";
import assert from "node:assert/strict";
import { extractUwTimestampFromRaw, resolveFlowTimes, flowEventTimeMs } from "./flow-timestamp";

/**
 * MEASURED, live member tape 5000 rows / 168h, 2026-08-23: 3500 rows (70%) carry no `event_at`,
 * and `event_at` is present iff `alert_rule` is (SPX 39/39, SPY 82/82). The 3500 carry
 * `implied_volatility`, whose only writer is the `option_trades` WS path — which DROPS prints with
 * a falsy `executed_at`. So each of those rows arrived with a truthy `executed_at` that
 * `new Date()` could not parse.
 *
 * These cover every plausible wire format, because the exact one could not be captured with the
 * market closed. The fix must not depend on the deduction being exactly right.
 */

const EXPECT = "2026-08-21T20:14:18.239Z";
const MS = 1787343258239; // epoch ms for EXPECT

test("epoch MILLISECONDS under executed_at now resolves — the deduced production case", () => {
  // Before: `new Date("1787343258239")` → Invalid Date → null → the row lost its print time.
  assert.equal(extractUwTimestampFromRaw({ executed_at: MS }), EXPECT);
  assert.equal(extractUwTimestampFromRaw({ executed_at: String(MS) }), EXPECT);
});

test("epoch seconds, microseconds and nanoseconds all resolve to the same instant", () => {
  // Parsed by MAGNITUDE, so the fix does not rest on knowing which unit UW sends.
  assert.equal(extractUwTimestampFromRaw({ created_at: Math.floor(MS / 1000) }), "2026-08-21T20:14:18.000Z");
  assert.equal(extractUwTimestampFromRaw({ created_at: MS * 1000 }), EXPECT);
  assert.equal(extractUwTimestampFromRaw({ created_at: MS * 1e6 }), EXPECT);
});

test("the ISO case that already worked still works, offset intact", () => {
  // Group A's real shape, captured live from UW the same day.
  assert.equal(
    extractUwTimestampFromRaw({ created_at: "2026-08-21T20:14:37.211537Z" }),
    "2026-08-21T20:14:37.211Z"
  );
});

test("a Z-bearing ISO string is NOT reinterpreted as local time", () => {
  // The `.slice(0, 19)` in normalizeOptionTradesWsPayload used to strip the Z, and a date-time with
  // no offset is LOCAL per spec — correct only by accident on a UTC container.
  assert.equal(extractUwTimestampFromRaw({ executed_at: "2026-06-30T15:04:00Z" }), "2026-06-30T15:04:00.000Z");
});

test("an implausible epoch yields null rather than a fabricated 1970 print", () => {
  // The old `start_time` branch did `ts > 1e12 ? ts : ts * 1000`, so 5 became 1970-01-01T00:00:05.
  // A print time invented from a junk number is worse than an absent one.
  assert.equal(extractUwTimestampFromRaw({ start_time: 5 }), null);
  assert.equal(extractUwTimestampFromRaw({ created_at: 0 }), null);
  assert.equal(extractUwTimestampFromRaw({ created_at: -1 }), null);
});

test("garbage is still null — the parser did not become permissive", () => {
  for (const bad of ["", "   ", "not-a-date", null, undefined, {}, [], NaN, Infinity]) {
    assert.equal(extractUwTimestampFromRaw({ created_at: bad as never }), null, `${JSON.stringify(bad)}`);
  }
});

test("field precedence is unchanged: created_at, then executed_at, then start_time", () => {
  assert.equal(
    extractUwTimestampFromRaw({ created_at: MS, executed_at: 1, start_time: 2 }),
    EXPECT
  );
  assert.equal(extractUwTimestampFromRaw({ executed_at: MS, start_time: 2 }), EXPECT);
  assert.equal(extractUwTimestampFromRaw({ start_time: MS }), EXPECT);
});

test("a row that gains event_at becomes SIGNAL-ELIGIBLE — the consequence, stated as a test", () => {
  // This is the whole point and the whole risk: both persisted HELIX signals filter on
  // flowEventTimeMs, so 70% of the tape moves from structurally-invisible to eligible.
  const before = flowEventTimeMs({ event_at: null, alerted_at: "2026-08-21T20:14:18Z", tape_time_estimated: true });
  assert.equal(before, null, "an ingest-time row must stay ineligible");

  const times = resolveFlowTimes({ raw_payload: { executed_at: MS }, inserted_at: "2026-08-22T01:00:00Z" });
  assert.equal(times.event_at, EXPECT);
  assert.equal(times.tape_time_estimated, false, "a real print time is not an estimate");
  assert.equal(flowEventTimeMs({ event_at: times.event_at }), MS);
});

test("with no parseable time at all, the ingest-time fallback still applies", () => {
  const times = resolveFlowTimes({ raw_payload: { executed_at: "junk" }, inserted_at: "2026-08-22T01:00:00Z" });
  assert.equal(times.event_at, null);
  assert.equal(times.tape_time_estimated, true, "display falls back, and says it is an estimate");
  assert.equal(times.display_at, "2026-08-22T01:00:00.000Z");
});
