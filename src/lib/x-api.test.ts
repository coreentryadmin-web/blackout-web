import { test } from "node:test";
import assert from "node:assert/strict";
import { xApiEnabled, X_ACCOUNT_USER_ID, X_BLOCK_RT_USERNAMES } from "./x-api";

/**
 * x-api.ts previously had NO test file at all despite being the live posting/engagement
 * surface for @BlackOutTrade. These cover the pure, env-driven pieces that don't require
 * mocking the real X API network calls (postTweet/fetchUserTweets/etc. all hit
 * https://api.x.com directly and are exercised instead by the callers' own test suites,
 * e.g. x-post-guard.test.ts, x-engage-engine.test.ts).
 */

const CRED_KEYS = [
  "X_API_KEY",
  "X_API_KEY_SECRET",
  "X_ACCESS_TOKEN",
  "X_ACCESS_TOKEN_SECRET",
] as const;

function withEnv(
  overrides: Partial<Record<(typeof CRED_KEYS)[number], string | undefined>>,
  fn: () => void,
) {
  const saved: Record<string, string | undefined> = {};
  for (const k of CRED_KEYS) saved[k] = process.env[k];
  try {
    for (const k of CRED_KEYS) {
      const v = overrides[k];
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    fn();
  } finally {
    for (const k of CRED_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

test("xApiEnabled is false when any credential is missing", () => {
  withEnv(
    {
      X_API_KEY: "k",
      X_API_KEY_SECRET: "s",
      X_ACCESS_TOKEN: "t",
      X_ACCESS_TOKEN_SECRET: undefined,
    },
    () => {
      assert.equal(xApiEnabled(), false);
    },
  );
});

test("xApiEnabled is false when a credential is present but blank", () => {
  withEnv(
    {
      X_API_KEY: "k",
      X_API_KEY_SECRET: "   ",
      X_ACCESS_TOKEN: "t",
      X_ACCESS_TOKEN_SECRET: "ts",
    },
    () => {
      assert.equal(xApiEnabled(), false);
    },
  );
});

test("xApiEnabled is true when all four credentials are present and non-blank", () => {
  withEnv(
    {
      X_API_KEY: "k",
      X_API_KEY_SECRET: "s",
      X_ACCESS_TOKEN: "t",
      X_ACCESS_TOKEN_SECRET: "ts",
    },
    () => {
      assert.equal(xApiEnabled(), true);
    },
  );
});

test("X_ACCOUNT_USER_ID and X_BLOCK_RT_USERNAMES are the stable identity constants", () => {
  assert.equal(X_ACCOUNT_USER_ID, "2055511397338087425");
  assert.ok(X_BLOCK_RT_USERNAMES.has("IHate0dte"));
  assert.ok(X_BLOCK_RT_USERNAMES.has("ihate0dte"));
});
