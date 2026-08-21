/**
 * Pure logic tests for the X marketing suppression gate.
 *
 * These inject the secret reader. The previous version deleted the env vars and relied on the
 * default reader returning nothing — which is only true where AWS Secrets Manager is unreachable.
 * On any machine that can read the prod blob (this repo's audit containers can: 98 keys) the
 * default reader returned prod's real X_MARKETING_POSTS_PAUSED=1 and the test failed. A unit test
 * must not ask production what the answer is.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isXMarketingCronSuppressed,
  xMarketingPausedInProdSecrets,
  X_MARKETING_CRON_KEYS,
} from "./x-marketing-paused.mjs";

/** Deterministic stand-in for the Secrets Manager / env reader. */
const reader = (secrets) => (key) => secrets[key] ?? "";

describe("x-marketing-paused", () => {

  it("suppresses all X cron keys when X_MARKETING_POSTS_PAUSED=1", () => {
    const read = reader({ X_MARKETING_POSTS_PAUSED: "1" });
    for (const key of X_MARKETING_CRON_KEYS) {
      assert.equal(isXMarketingCronSuppressed(key, read), true);
    }
    assert.equal(isXMarketingCronSuppressed("flow-ingest", read), false, "non-X crons are never suppressed");
  });

  it("suppresses only x-replies when mention pause alone", () => {
    const read = reader({ X_MENTION_REPLIES_PAUSED: "1" });
    assert.equal(isXMarketingCronSuppressed("x-replies", read), true);
    assert.equal(isXMarketingCronSuppressed("x-growth", read), false);
  });

  it("suppresses nothing when neither flag is set", () => {
    const read = reader({});
    for (const key of X_MARKETING_CRON_KEYS) {
      assert.equal(isXMarketingCronSuppressed(key, read), false);
    }
  });

  it("accepts the documented truthy spellings", () => {
    for (const v of ["1", "true", "TRUE", "yes"]) {
      assert.equal(xMarketingPausedInProdSecrets(reader({ X_MARKETING_POSTS_PAUSED: v })), true, v);
    }
    for (const v of ["0", "false", "no", ""]) {
      assert.equal(xMarketingPausedInProdSecrets(reader({ X_MARKETING_POSTS_PAUSED: v })), false, v);
    }
  });
});
