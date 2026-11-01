import { test } from "node:test";
import assert from "node:assert/strict";
import {
  awaitWithWarmDeadline,
  zerodteScanWarmTimeoutMs,
} from "./scan-warm-deadline";

test("zerodteScanWarmTimeoutMs defaults to 8 minutes", () => {
  const prev = process.env.ZERODTE_SCAN_WARM_TIMEOUT_MS;
  delete process.env.ZERODTE_SCAN_WARM_TIMEOUT_MS;
  assert.equal(zerodteScanWarmTimeoutMs(), 8 * 60_000);
  process.env.ZERODTE_SCAN_WARM_TIMEOUT_MS = "1500";
  assert.equal(zerodteScanWarmTimeoutMs(), 1500);
  if (prev === undefined) delete process.env.ZERODTE_SCAN_WARM_TIMEOUT_MS;
  else process.env.ZERODTE_SCAN_WARM_TIMEOUT_MS = prev;
});

test("awaitWithWarmDeadline returns value when work finishes first", async () => {
  const out = await awaitWithWarmDeadline(Promise.resolve(42), 500);
  assert.deepEqual(out, { ok: true, value: 42 });
});

test("awaitWithWarmDeadline returns timeout when work is slower than the deadline", async () => {
  const hang = new Promise<number>(() => {});
  const out = await awaitWithWarmDeadline(hang, 25);
  assert.deepEqual(out, { ok: false, reason: "timeout" });
});

test("awaitWithWarmDeadline returns error when work rejects before the deadline", async () => {
  const out = await awaitWithWarmDeadline(Promise.reject(new Error("boom")), 500);
  assert.equal(out.ok, false);
  if (!out.ok && out.reason === "error") {
    assert.equal((out.error as Error).message, "boom");
  } else {
    assert.fail("expected error result");
  }
});
