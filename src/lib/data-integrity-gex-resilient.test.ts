import assert from "node:assert/strict";
import test from "node:test";

import { retryGexPositioningRead } from "./data-integrity-gex-resilient.ts";

test("retryGexPositioningRead returns first non-null hit", async () => {
  let attempt = 0;
  const pos = await retryGexPositioningRead(
    "SPX",
    async () => {
      attempt++;
      return attempt >= 2 ? ({ spot: 1 } as { spot: number }) : null;
    },
    { attempts: 3, baseDelayMs: 1, sleepMs: async () => undefined }
  );
  assert.ok(pos);
  assert.equal(attempt, 2);
});

test("retryGexPositioningRead exhausts attempts", async () => {
  let attempt = 0;
  const pos = await retryGexPositioningRead(
    "SPY",
    async () => {
      attempt++;
      return null;
    },
    { attempts: 2, baseDelayMs: 1, sleepMs: async () => undefined }
  );
  assert.equal(pos, null);
  assert.equal(attempt, 2);
});
