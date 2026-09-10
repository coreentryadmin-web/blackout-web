import { test } from "node:test";
import assert from "node:assert/strict";
import { withBriefSourceTimeout } from "./brief-source-timeout";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test("withBriefSourceTimeout: resolves the real value when the read finishes well inside budget", async () => {
  const p = Promise.resolve({ hello: "world" });
  const out = await withBriefSourceTimeout(p, 50);
  assert.deepEqual(out, { hello: "world" });
});

test("withBriefSourceTimeout: degrades to null when the read exceeds the budget (never blocks the caller)", async () => {
  const started = Date.now();
  const wedged = sleep(300).then(() => "too late");
  const out = await withBriefSourceTimeout(wedged, 20);
  assert.equal(out, null, "a wedged source must degrade to null, not hang the caller");
  assert.ok(Date.now() - started < 500, "must resolve near the timeout budget, not the source's own delay");
});

test("withBriefSourceTimeout: degrades to null on rejection rather than throwing", async () => {
  const rejected = Promise.reject(new Error("cache read failed"));
  const out = await withBriefSourceTimeout(rejected, 50);
  assert.equal(out, null, "a thrown optional read must read as null, not propagate");
});

test("withBriefSourceTimeout: a late rejection after timeout does not surface as an unhandled rejection", async () => {
  // Regression guard for the exact failure this wrapper must avoid: Promise.race attaches a handler
  // to EVERY promise passed to it (including the timeout's loser), so a source that rejects AFTER
  // the timeout already won the race must not crash the process via an unhandled rejection.
  let sawUnhandled = false;
  const onUnhandled = () => {
    sawUnhandled = true;
  };
  process.on("unhandledRejection", onUnhandled);
  try {
    const lateReject = sleep(30).then(() => {
      throw new Error("late failure, after the timeout already resolved");
    });
    const out = await withBriefSourceTimeout(lateReject, 5);
    assert.equal(out, null);
    // Give the late rejection a tick to surface (or not) before asserting.
    await sleep(80);
    assert.equal(sawUnhandled, false, "the loser's later rejection must not become an unhandled rejection");
  } finally {
    process.off("unhandledRejection", onUnhandled);
  }
});

test("withBriefSourceTimeout: default budget is exported and matches the documented 8s", async () => {
  const { BRIEF_SOURCE_TIMEOUT_MS } = await import("./brief-source-timeout");
  assert.equal(BRIEF_SOURCE_TIMEOUT_MS, 8_000);
});
