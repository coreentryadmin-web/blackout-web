import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeDarkPoolAccumRows } from "./uw-socket";
import { normalizeDarkPoolWsPayload, type DarkPoolSnapshot } from "@/lib/providers/unusual-whales";

// Small, fixed SECOND offsets (never minutes/hours) so these fixtures stay on today's ET
// calendar date no matter what wall-clock time the suite happens to run at — a minutes/hours
// offset risks crossing the ET midnight boundary (e.g. a run at 01:00 ET treating "4 hours ago"
// as yesterday), which would make `normalizeDarkPoolWsPayload`'s own today-ET filter correctly,
// but confusingly, drop the fixture.
function spxRow(premium: number, secondsAgo: number, optType: "call" | "put" | "" = "") {
  const at = new Date(Date.now() - secondsAgo * 1000).toISOString();
  return {
    ticker: "SPX",
    premium,
    price: 5900,
    side: "below",
    executed_at: at,
    type: optType,
  };
}

test("mergeDarkPoolAccumRows: accumulates across frames instead of discarding prior rows", () => {
  const frame1 = [spxRow(5_000_000, 20)];
  const frame2 = [spxRow(3_000_000, 5)];

  let accum: Record<string, unknown>[] = [];
  accum = mergeDarkPoolAccumRows(accum, frame1);
  assert.equal(accum.length, 1);
  accum = mergeDarkPoolAccumRows(accum, frame2);

  // The whole point of accumulating: frame1's row must still be present after frame2 merges in.
  assert.equal(accum.length, 2, "both frames' rows must survive — accumulation, not overwrite");
});

test("mergeDarkPoolAccumRows: dedups the identical row delivered twice (e.g. a retried frame)", () => {
  const row = spxRow(1_000_000, 10);
  let accum: Record<string, unknown>[] = [];
  accum = mergeDarkPoolAccumRows(accum, [row]);
  accum = mergeDarkPoolAccumRows(accum, [{ ...row }]);
  assert.equal(accum.length, 1, "an identical row (same ticker/premium/time/price) must not double-count");
});

test("mergeDarkPoolAccumRows: caps at `max`, dropping the oldest first", () => {
  let accum: Record<string, unknown>[] = [spxRow(1, 15)];
  const fresh = [spxRow(2, 3)];
  accum = mergeDarkPoolAccumRows(accum, fresh, 1);
  assert.equal(accum.length, 1);
  assert.equal((accum[0] as { premium: number }).premium, 2, "oldest row must be dropped once over cap, newest kept");
});

test(
  "THE BUG: re-normalizing only the LATEST frame silently loses an earlier SPX print's premium " +
    "from the session total — accumulating first and re-normalizing fixes it",
  () => {
    const frame1 = [spxRow(5_000_000, 20)]; // a real SPX print earlier in the session
    const frame2 = [spxRow(3_000_000, 5)]; // a second, later SPX print

    // OLD behavior (what `darkPoolStore.data = normalizeDarkPoolWsPayload(payload, "SPX")`
    // did on every frame, pre-fix): normalizing frame2 ALONE after frame1 already arrived.
    const oldBehaviorSnapshot = normalizeDarkPoolWsPayload(frame2, "SPX") as DarkPoolSnapshot;
    assert.equal(
      oldBehaviorSnapshot.total_premium,
      3_000_000,
      "sanity: normalizing only the latest frame reports only that frame's premium"
    );
    // This is the defect: frame1's real, already-executed $5M print has vanished from the
    // session's reported total — not because the trading day un-happened, but because
    // nothing accumulated it.
    assert.notEqual(oldBehaviorSnapshot.total_premium, 8_000_000);

    // NEW behavior (the fix): merge raw rows into a session accumulator, then re-normalize
    // the FULL accumulated set every frame.
    let accum: Record<string, unknown>[] = [];
    accum = mergeDarkPoolAccumRows(accum, frame1);
    const afterFrame1 = normalizeDarkPoolWsPayload(accum, "SPX") as DarkPoolSnapshot;
    assert.equal(afterFrame1.total_premium, 5_000_000);

    accum = mergeDarkPoolAccumRows(accum, frame2);
    const afterFrame2 = normalizeDarkPoolWsPayload(accum, "SPX") as DarkPoolSnapshot;
    assert.equal(
      afterFrame2.total_premium,
      8_000_000,
      "the session total must include BOTH prints once accumulated, not just the latest"
    );
    assert.ok(afterFrame2.prints.length >= 2);
  }
);

test("mergeDarkPoolAccumRows: a frame with no rows is a no-op (returns the same accumulator)", () => {
  const accum = [spxRow(1_000_000, 5)];
  const result = mergeDarkPoolAccumRows(accum, []);
  assert.equal(result, accum, "an empty fresh-rows array must return the identical reference, not a copy");
});
