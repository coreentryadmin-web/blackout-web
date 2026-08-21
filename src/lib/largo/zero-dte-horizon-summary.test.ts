import { strict as assert } from "node:assert";
import test from "node:test";
import { zeroDteHorizonSummary } from "./zero-dte-horizon-summary";

const OPEN = { ticker: "NVDA", direction: "long", status: "OPEN" };
const CLOSED = { ticker: "TSLA", direction: "short", status: "CLOSED" };

test("a real read counts what it actually saw", () => {
  const s = zeroDteHorizonSummary({ available: true, plays: [OPEN, CLOSED] });
  assert.equal(s.available, true);
  if (!s.available) throw new Error("unreachable");
  assert.equal(s.play_count, 2);
  assert.equal(s.open_count, 1, "a CLOSED row is not open");
  assert.deepEqual(s.sample, ["NVDA long (OPEN)"]);
});

test("a MEASURED empty session is still a measurement — zero is the right answer here", () => {
  const s = zeroDteHorizonSummary({ available: true, plays: [] });
  assert.equal(s.available, true);
  if (!s.available) throw new Error("unreachable");
  assert.equal(s.open_count, 0);
});

test("a thrown read is UNKNOWN and carries no number to quote", () => {
  const s = zeroDteHorizonSummary(null);
  assert.equal(s.available, false);
  assert.equal("open_count" in s, false, "there must be nothing for a model to quote");
  assert.equal("play_count" in s, false);
  assert.match(String((s as { note: string }).note), /not reported as 0/);
});

test("an explicit available:false is an answer, and the answer is unknown", () => {
  // What #2492's get_zerodte_plays returns when the board could not be built.
  const s = zeroDteHorizonSummary({
    available: false,
    degraded: true,
    reason: "board_upstream_unavailable",
    session_date: "2026-08-21",
  });
  assert.equal(s.available, false);
  assert.equal((s as { reason: string }).reason, "board_upstream_unavailable", "the producer's reason survives");
  assert.equal("open_count" in s, false);
});

test("an absent plays key is unknown, not empty — #2492 omits it on purpose", () => {
  const s = zeroDteHorizonSummary({ available: true, session_date: "2026-08-21" });
  assert.equal(s.available, false);
  assert.equal((s as { reason: string }).reason, "zerodte_plays_absent");
  assert.equal("open_count" in s, false);
});

test("the two zeros never serialize alike", () => {
  const measured = zeroDteHorizonSummary({ available: true, plays: [] });
  const unknown = zeroDteHorizonSummary(null);
  assert.notEqual(JSON.stringify(measured), JSON.stringify(unknown));
});

test("a malformed row cannot crash the summary or inflate the open count", () => {
  const s = zeroDteHorizonSummary({ available: true, plays: [{}, { status: "graded" }, OPEN] });
  assert.equal(s.available, true);
  if (!s.available) throw new Error("unreachable");
  assert.equal(s.play_count, 3);
  assert.equal(s.open_count, 2, "an unknown status is not treated as closed");
});

test("the sample is capped so this summary can never become the payload", () => {
  const many = Array.from({ length: 30 }, (_, i) => ({ ticker: `T${i}`, direction: "long", status: "OPEN" }));
  const s = zeroDteHorizonSummary({ available: true, plays: many });
  assert.equal(s.available, true);
  if (!s.available) throw new Error("unreachable");
  assert.equal(s.open_count, 30, "the COUNT is complete");
  assert.equal(s.sample.length, 6, "the SAMPLE is bounded");
});
