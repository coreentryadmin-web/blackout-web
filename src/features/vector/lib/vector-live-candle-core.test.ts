import { test } from "node:test";
import assert from "node:assert/strict";
import {
  REST_MAX_AGE_MS,
  REST_REFRESH_MS,
  isRestEntryUsable,
  restCacheEvictions,
  shouldRefreshRest,
} from "./vector-live-candle-core";

// ── shouldRefreshRest ────────────────────────────────────────────────────────

test("shouldRefreshRest: a ticker with no entry is always due", () => {
  assert.equal(shouldRefreshRest(undefined, 1_000_000), true);
});

test("shouldRefreshRest: throttles inside the window, allows at the boundary", () => {
  const now = 1_000_000;
  const entry = { fetchedAt: now - REST_REFRESH_MS + 1, updatedAt: now };
  assert.equal(shouldRefreshRest(entry, now), false, "inside the window must not re-fetch");
  assert.equal(
    shouldRefreshRest({ fetchedAt: now - REST_REFRESH_MS, updatedAt: now }, now),
    true,
    "exactly at the window is due — the throttle is a minimum gap, not a strict inequality"
  );
});

test("shouldRefreshRest: a future-stamped entry does not lock the ticker out", () => {
  // A clock step (or an entry written by a process whose clock is ahead) leaves fetchedAt in the
  // future. `now - fetchedAt` is then negative, which a naive `< refreshMs` check reads as "just
  // fetched" — and the ticker would stop refreshing until real time caught up, which for a large
  // step could be the rest of the session. Treated as due instead.
  const now = 1_000_000;
  assert.equal(shouldRefreshRest({ fetchedAt: now + 60_000, updatedAt: now }, now), true);
});

// ── isRestEntryUsable ────────────────────────────────────────────────────────

test("isRestEntryUsable: needs an actual candle, not just an entry", () => {
  const now = 1_000_000;
  assert.equal(isRestEntryUsable(undefined, now), false);
  assert.equal(isRestEntryUsable({ candle: null, updatedAt: now, fetchedAt: now }, now), false);
  assert.equal(isRestEntryUsable({ candle: {}, updatedAt: now, fetchedAt: now }, now), true);
});

test("isRestEntryUsable: expires exactly at REST_MAX_AGE_MS, not after", () => {
  const now = 5_000_000;
  const at = (age: number) => isRestEntryUsable({ candle: {}, updatedAt: now - age, fetchedAt: now }, now);
  assert.equal(at(REST_MAX_AGE_MS - 1), true);
  assert.equal(at(REST_MAX_AGE_MS), true, "the boundary is still usable");
  assert.equal(at(REST_MAX_AGE_MS + 1), false, "one ms past the bound is not");
});

test("isRestEntryUsable: a future-stamped candle is rejected rather than treated as fresh", () => {
  const now = 1_000_000;
  assert.equal(isRestEntryUsable({ candle: {}, updatedAt: now + 10_000, fetchedAt: now }, now), false);
});

// ── restCacheEvictions ───────────────────────────────────────────────────────

const timing = (fetchedAt: number) => ({ fetchedAt, updatedAt: fetchedAt });

test("restCacheEvictions: nothing to do at or under the cap", () => {
  const m = new Map([["A", timing(1)], ["B", timing(2)]]);
  assert.deepEqual(restCacheEvictions(m, 2), []);
  assert.deepEqual(restCacheEvictions(m, 5), []);
});

test("restCacheEvictions: drops the LEAST-RECENTLY-FETCHED, keeps the hot ones", () => {
  // The behaviour this replaces was `.clear()` — everything, including whatever the member is
  // actually watching. This is the whole point of the change, so it is pinned explicitly.
  const m = new Map([
    ["OLDEST", timing(100)],
    ["OLD", timing(200)],
    ["WARM", timing(300)],
    ["HOT", timing(400)],
  ]);
  const dropped = restCacheEvictions(m, 2);
  assert.deepEqual(dropped, ["OLDEST", "OLD"], "oldest first");
  const kept = [...m.keys()].filter((k) => !dropped.includes(k));
  assert.deepEqual(kept, ["WARM", "HOT"], "the most recently fetched survive");
});

test("restCacheEvictions: drops exactly the overflow, never the whole cache", () => {
  const m = new Map(Array.from({ length: 205 }, (_, i) => [`T${i}`, timing(i)] as const));
  const dropped = restCacheEvictions(m, 200);
  assert.equal(dropped.length, 5, "205 entries over a 200 cap sheds 5, not 205");
  assert.equal(dropped[0], "T0");
  assert.equal(dropped.at(-1), "T4");
});
