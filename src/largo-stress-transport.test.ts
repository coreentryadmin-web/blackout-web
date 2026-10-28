import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

test("largo-stress-run: fetch failures become status 0 SKIP, not uncaught throws", () => {
  const src = readFileSync(join(import.meta.dirname, "..", "scripts", "largo-stress-run.mjs"), "utf8");
  assert.match(
    src,
    /catch \(err\)[\s\S]*status: 0[\s\S]*transport_error/,
    "askLive must catch exhausted fetchRetry and return transport status 0",
  );
  assert.match(
    src,
    /last\.status !== 429 && last\.status !== 0/,
    "askLiveThrottleAware must backoff-retry transport (status 0) like 429",
  );
  assert.match(
    src,
    /transport_failed: true/,
    "exhausted transport retries must flag transport_failed for reporting",
  );
});
