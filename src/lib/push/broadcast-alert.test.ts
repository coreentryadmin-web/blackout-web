import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { broadcastAlert } from "./broadcast-alert";

// These tests run in an environment where neither VAPID nor APNs env is
// configured (that's the standard local + CI condition). They prove:
//   1. broadcastAlert NEVER throws even with zero channels configured.
//   2. The returned envelope tells the caller EXACTLY which channels were
//      configured and what they attempted — so a cron log carries the truth
//      (apns.configured=false → "we didn't send, we're not set up") instead
//      of a silent zero that reads as "we tried and nobody was there".
//
// The full-integration send-loop tests live in each channel's own file
// (send-apns-push.test.ts, and the future send-web-push tests) — this file
// is specifically about the fan-out contract.

describe("broadcastAlert — inert environment", () => {
  it("returns a well-shaped envelope without throwing", async () => {
    const result = await broadcastAlert({
      title: "Test",
      body: "Body",
      url: "/dashboard",
    });
    // Both channel envelopes present regardless of config state.
    assert.equal(typeof result.web.configured, "boolean");
    assert.equal(typeof result.web.sent, "number");
    assert.equal(typeof result.web.pruned, "number");
    assert.equal(typeof result.apns.configured, "boolean");
    assert.equal(typeof result.apns.attempted, "number");
    assert.equal(typeof result.apns.sent, "number");
    assert.equal(typeof result.apns.pruned, "number");
    // totalSent is the sum — sanity guarantee for cron log math.
    assert.equal(result.totalSent, result.web.sent + result.apns.sent);
  });

  it("with no APNs env, apns.configured is false and sent is 0", async () => {
    // Explicitly clear to guarantee the test doesn't depend on outer env.
    const originals: Record<string, string | undefined> = {
      APNS_TEAM_ID: process.env.APNS_TEAM_ID,
      APNS_KEY_ID: process.env.APNS_KEY_ID,
      APNS_PRIVATE_KEY: process.env.APNS_PRIVATE_KEY,
      APNS_BUNDLE_ID: process.env.APNS_BUNDLE_ID,
    };
    try {
      for (const k of Object.keys(originals)) delete process.env[k];
      const result = await broadcastAlert({ title: "T", body: "B" });
      assert.equal(result.apns.configured, false);
      assert.equal(result.apns.sent, 0);
      assert.equal(result.apns.attempted, 0);
    } finally {
      for (const [k, v] of Object.entries(originals)) {
        if (v === undefined) delete process.env[k]; else process.env[k] = v;
      }
    }
  });
});
