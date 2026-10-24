import { test } from "node:test";
import assert from "node:assert/strict";
import { withBriefSourceTimeout, BRIEF_SOURCE_TIMEOUT_MS } from "./brief-source-timeout";

test("rejects with a named SwingBriefSourceTimeout before an upstream that never resolves", async () => {
  const neverResolves = new Promise<never>(() => {});
  await assert.rejects(withBriefSourceTimeout(neverResolves, 20), (err: Error) => {
    assert.equal(err.name, "SwingBriefSourceTimeout");
    return true;
  });
});

test("resolves with the upstream value when it finishes inside the budget", async () => {
  const fast = Promise.resolve("ok");
  assert.equal(await withBriefSourceTimeout(fast, 50), "ok");
});

test("propagates a genuine upstream rejection unchanged, not as a timeout", async () => {
  const upstreamError = new Error("boom");
  const failing = Promise.reject(upstreamError);
  await assert.rejects(withBriefSourceTimeout(failing, 50), (err: Error) => {
    assert.equal(err, upstreamError);
    return true;
  });
});

test("default budget matches the documented per-source constant", () => {
  assert.equal(BRIEF_SOURCE_TIMEOUT_MS, 8_000);
});
