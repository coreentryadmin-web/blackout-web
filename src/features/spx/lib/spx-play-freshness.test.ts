import { test } from "node:test";
import assert from "node:assert/strict";
import { isSpxPlaySnapshotFreshEnough } from "./spx-play-freshness";

// Live production bug this guards against (2026-09-13 audit): GET /api/market/spx/play polled
// every ~1s served snapshots up to ~234s stale, `as_of` jumping BACKWARD between consecutive
// requests, `assessed`/`score` flapping true/39 <-> false/0 a second apart — because the peek
// path trusted ANY non-null cached value regardless of age, tolerating peekServerCache's generic
// up-to-10-minute staleness ceiling instead of this route's real 5s freshness contract.

test("fresh snapshot (well within the bound) is accepted", () => {
  const now = 1_000_000;
  assert.equal(isSpxPlaySnapshotFreshEnough(new Date(now - 2_000).toISOString(), now, 20_000), true);
});

test("snapshot exactly at the bound is accepted (inclusive)", () => {
  const now = 1_000_000;
  assert.equal(isSpxPlaySnapshotFreshEnough(new Date(now - 20_000).toISOString(), now, 20_000), true);
});

test("snapshot one ms past the bound is rejected", () => {
  const now = 1_000_000;
  assert.equal(isSpxPlaySnapshotFreshEnough(new Date(now - 20_001).toISOString(), now, 20_000), false);
});

test("the live-production case: a snapshot ~234s stale against a 20s bound is rejected", () => {
  const now = Date.parse("2026-09-13T08:11:56.303Z");
  const asOf = "2026-09-13T08:08:02.711Z"; // 233.6s older, per the live audit evidence
  assert.equal(isSpxPlaySnapshotFreshEnough(asOf, now, 20_000), false);
});

test("null/undefined as_of is rejected (fail closed, never trust an undated snapshot)", () => {
  assert.equal(isSpxPlaySnapshotFreshEnough(null, 1_000_000, 20_000), false);
  assert.equal(isSpxPlaySnapshotFreshEnough(undefined, 1_000_000, 20_000), false);
  assert.equal(isSpxPlaySnapshotFreshEnough("", 1_000_000, 20_000), false);
});

test("unparseable as_of is rejected (fail closed, never crash on garbage input)", () => {
  assert.equal(isSpxPlaySnapshotFreshEnough("not-a-date", 1_000_000, 20_000), false);
});

test("a future as_of (clock skew) is still accepted — this check only guards staleness, not skew", () => {
  const now = 1_000_000;
  assert.equal(isSpxPlaySnapshotFreshEnough(new Date(now + 5_000).toISOString(), now, 20_000), true);
});
