import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  X_DAILY_CAPS,
  X_CRON_RUN_CAPS,
  engagementJitterMs,
} from "./x-rate-budget";

describe("x-rate-budget", () => {
  it("cron run caps stay below daily caps", () => {
    assert.ok(X_CRON_RUN_CAPS.likes <= X_DAILY_CAPS.likes);
    assert.ok(X_CRON_RUN_CAPS.follows <= X_DAILY_CAPS.follows);
    assert.ok(X_CRON_RUN_CAPS.replies <= X_DAILY_CAPS.replies);
  });

  it("jitter is at least 2s", () => {
    for (let i = 0; i < 20; i += 1) {
      assert.ok(engagementJitterMs() >= 2000);
      assert.ok(engagementJitterMs() <= 4500);
    }
  });
});
