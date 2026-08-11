import test from "node:test";
import assert from "node:assert/strict";
import {
  TIKTOK_SCOPES,
  needsRefresh,
  newOauthState,
  REFRESH_MARGIN_MS,
  stateMatches,
  tiktokAuthorizeUrl,
  tiktokOauthConfigured,
  tiktokRedirectUri,
} from "./tiktok-oauth";

/**
 * The token exchange itself needs TikTok, so what is tested here is everything that decides
 * WHETHER a request is legitimate and whether a stored token is still usable. Both are places
 * where being wrong is silent: a state check that accepts anything binds a stranger's account,
 * and a refresh predicate that is off by a sign publishes nothing while reporting success.
 */

function withCreds<T>(fn: () => T): T {
  const k = process.env.TIKTOK_CLIENT_KEY;
  const s = process.env.TIKTOK_CLIENT_SECRET;
  process.env.TIKTOK_CLIENT_KEY = "test-key";
  process.env.TIKTOK_CLIENT_SECRET = "test-secret";
  try {
    return fn();
  } finally {
    if (k === undefined) delete process.env.TIKTOK_CLIENT_KEY;
    else process.env.TIKTOK_CLIENT_KEY = k;
    if (s === undefined) delete process.env.TIKTOK_CLIENT_SECRET;
    else process.env.TIKTOK_CLIENT_SECRET = s;
  }
}

test("missing client credentials mean NOT configured, and no authorize URL", () => {
  const k = process.env.TIKTOK_CLIENT_KEY;
  delete process.env.TIKTOK_CLIENT_KEY;
  assert.equal(tiktokOauthConfigured(), false);
  assert.equal(tiktokAuthorizeUrl("abc"), null);
  if (k !== undefined) process.env.TIKTOK_CLIENT_KEY = k;
});

test("authorize URL carries the state, the redirect URI and every scope", () => {
  withCreds(() => {
    const url = tiktokAuthorizeUrl("state-123");
    assert.ok(url);
    const u = new URL(url!);
    assert.equal(u.searchParams.get("state"), "state-123");
    assert.equal(u.searchParams.get("response_type"), "code");
    assert.equal(u.searchParams.get("client_key"), "test-key");
    // The secret must never travel on a URL the operator's browser follows.
    assert.equal(u.searchParams.get("client_secret"), null);
    assert.equal(u.searchParams.get("redirect_uri"), tiktokRedirectUri());
    assert.deepEqual(u.searchParams.get("scope")?.split(","), [...TIKTOK_SCOPES]);
  });
});

test("the redirect URI is absolute and matches the callback route exactly", () => {
  // A trailing slash on the site URL used to produce `//api/...`, which TikTok rejects as a
  // mismatch against the console registration — an error that only shows up at consent time.
  const saved = process.env.NEXT_PUBLIC_SITE_URL;
  process.env.NEXT_PUBLIC_SITE_URL = "https://blackouttrades.com/";
  assert.equal(tiktokRedirectUri(), "https://blackouttrades.com/api/social/tiktok/callback");
  if (saved === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
  else process.env.NEXT_PUBLIC_SITE_URL = saved;
});

test("state must match exactly; absent or partial is a rejection", () => {
  const s = newOauthState();
  assert.equal(stateMatches(s, s), true);
  assert.equal(stateMatches(s, s.slice(0, -1)), false);
  assert.equal(stateMatches(s, s.slice(0, -1) + "0"), false);
  assert.equal(stateMatches(undefined, s), false);
  assert.equal(stateMatches(s, undefined), false);
  assert.equal(stateMatches("", ""), false);
});

test("states are unguessable and unique per call", () => {
  const a = newOauthState();
  const b = newOauthState();
  assert.notEqual(a, b);
  assert.ok(a.length >= 32);
});

test("refresh happens BEFORE expiry, and an unknown expiry refreshes", () => {
  const now = 1_000_000_000_000;
  assert.equal(needsRefresh(now + REFRESH_MARGIN_MS * 2, now), false);
  // Inside the margin: still technically valid, but too close to spend on a scheduled post.
  assert.equal(needsRefresh(now + REFRESH_MARGIN_MS - 1, now), true);
  assert.equal(needsRefresh(now - 1, now), true);
  assert.equal(needsRefresh(null, now), true);
});
