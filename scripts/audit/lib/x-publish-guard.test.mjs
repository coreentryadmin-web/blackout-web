import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  HYDRATED_ENV_KEYS,
  hydratePublishEnv,
  publishRefusalReason,
} from "./x-publish-guard.mjs";

const OK = { paused: false, hasCredentials: true, contentValid: true, guard: { allowed: true } };

describe("publishRefusalReason", () => {
  it("allows a clean publish", () => {
    assert.equal(publishRefusalReason(OK), null);
  });

  it("REFUSES when the account is paused — the defect this module exists to close", () => {
    const reason = publishRefusalReason({ ...OK, paused: true });
    assert.match(String(reason), /X_MARKETING_POSTS_PAUSED/);
  });

  it("checks the pause flag BEFORE anything that would spend an API call", () => {
    // Paused must win even when every other input is also bad: if a later gate could pre-empt it,
    // the refusal message would send an operator looking at the wrong problem, and any gate that
    // reads the timeline first has already spent a request on a paused account.
    const reason = publishRefusalReason({
      paused: true,
      hasCredentials: false,
      contentValid: false,
      guard: { allowed: false, reason: "Daily cap reached (7/7)" },
    });
    assert.match(String(reason), /X_MARKETING_POSTS_PAUSED/);
  });

  it("refuses on missing credentials", () => {
    assert.match(String(publishRefusalReason({ ...OK, hasCredentials: false })), /credentials/);
  });

  it("refuses content the cron path would also reject", () => {
    assert.match(String(publishRefusalReason({ ...OK, contentValid: false })), /isTweetContentValid/);
  });

  it("refuses and reports the guard's own reason when the rate gate says no", () => {
    const reason = publishRefusalReason({
      ...OK,
      guard: { allowed: false, reason: "Too soon (12m since last post, need 110m)" },
    });
    assert.match(String(reason), /Too soon \(12m/);
  });

  it("does not invent a reason when the guard refuses without one", () => {
    const reason = publishRefusalReason({ ...OK, guard: { allowed: false } });
    assert.match(String(reason), /no reason given/);
  });

  it("treats an absent guard as non-blocking — absence is not a refusal here", () => {
    // resolvePublishRefusal only omits the guard when an earlier gate already failed, so a null
    // guard reaching this function alongside otherwise-clean inputs must not fabricate a block.
    assert.equal(publishRefusalReason({ ...OK, guard: null }), null);
  });
});

describe("hydratePublishEnv", () => {
  it("lifts the pause flag out of the secrets blob so the real helper can see it", () => {
    const env = {};
    hydratePublishEnv({ X_MARKETING_POSTS_PAUSED: "1" }, env);
    assert.equal(env.X_MARKETING_POSTS_PAUSED, "1");
  });

  it("does NOT overwrite a value the operator set explicitly", () => {
    // A local pause must be able to stop a run even when production is unpaused.
    const env = { X_MARKETING_POSTS_PAUSED: "1" };
    hydratePublishEnv({ X_MARKETING_POSTS_PAUSED: "0" }, env);
    assert.equal(env.X_MARKETING_POSTS_PAUSED, "1");
  });

  it("copies only the publish-relevant keys, never the whole production blob", () => {
    const env = {};
    hydratePublishEnv(
      { X_API_KEY: "k", DATABASE_URL: "postgres://secret", POLYGON_API_KEY: "p" },
      env,
    );
    assert.equal(env.X_API_KEY, "k");
    assert.equal(env.DATABASE_URL, undefined);
    assert.equal(env.POLYGON_API_KEY, undefined);
  });

  it("skips empty values rather than writing an empty string over nothing", () => {
    const env = {};
    hydratePublishEnv({ X_API_KEY: "" }, env);
    assert.equal(env.X_API_KEY, undefined);
  });

  it("tolerates a missing or malformed blob", () => {
    assert.deepEqual(hydratePublishEnv(undefined, {}), []);
    assert.deepEqual(hydratePublishEnv(null, {}), []);
  });

  it("carries the pause flag in its key list — the whole point of hydrating at all", () => {
    assert.ok(HYDRATED_ENV_KEYS.includes("X_MARKETING_POSTS_PAUSED"));
  });
});
