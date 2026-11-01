import { test } from "node:test";
import assert from "node:assert/strict";
import * as xApi from "./x-api";
import {
  xApiEnabled,
  X_ACCOUNT_USER_ID,
  X_BLOCK_RT_USERNAMES,
  classifyFollowError,
} from "./x-api";

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

test("classifyFollowError: a bare 403 with no 'already'/'duplicate' wording is a real failure, not already_following", () => {
  // This is the regression: a 403 from X's /following endpoint can mean the target
  // blocked us, the target account is suspended, or our app's access tier can't write
  // follows — none of those are "we already follow this account". Previously ANY 403
  // was collapsed into already_following purely on status code, silently hiding every
  // one of those real failures from stats.errors in x-engage-engine.ts forever.
  assert.equal(
    classifyFollowError(403, '{"errors":[{"message":"You are unable to follow this user."}]}'),
    "failed",
  );
  assert.equal(
    classifyFollowError(403, '{"title":"Forbidden","detail":"Your account is not permitted to follow at this access level."}'),
    "failed",
  );
});

test("classifyFollowError: a 403 body that actually says already/duplicate is already_following", () => {
  assert.equal(
    classifyFollowError(403, '{"errors":[{"message":"You have already requested to follow this user."}]}'),
    "already_following",
  );
  assert.equal(
    classifyFollowError(403, '{"errors":[{"message":"Duplicate follow request."}]}'),
    "already_following",
  );
});

test("classifyFollowError: a 409 Conflict is treated as already_following regardless of body wording", () => {
  assert.equal(classifyFollowError(409, "{}"), "already_following");
});

test("classifyFollowError: any other status with an unrelated body is a real failure", () => {
  assert.equal(classifyFollowError(500, "internal error"), "failed");
  assert.equal(classifyFollowError(401, "unauthorized"), "failed");
});

test("postThread stays removed — a dead thread-posting wrapper with zero callers anywhere in the repo since it was added (#847); do not re-add it as a thin re-export without a real caller", () => {
  assert.equal(
    (xApi as Record<string, unknown>).postThread,
    undefined,
    "postThread should not be re-exported from x-api.ts unless a real caller is wired up alongside it",
  );
});
