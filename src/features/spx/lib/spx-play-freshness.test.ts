import { test } from "node:test";
import assert from "node:assert/strict";
import { isSpxPlaySnapshotFreshEnough, isSpxPlaySnapshotShareable } from "./spx-play-freshness";

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

// isSpxPlaySnapshotShareable — regression for a same-day follow-up bug (2026-10-25): PR #6719
// applied isSpxPlaySnapshotFreshEnough unconditionally at the cross-replica Redis-read sites in
// spx-service.ts. That's correct for a LIVE-MARKET snapshot (as_of is real eval time), but a
// CLOSED-MARKET snapshot's as_of is deliberately the desk snapshot's own old timestamp
// (evaluateSpxPlayCore's closed-market branch, spx-play-engine.ts) -- a 20s bound can never pass
// against it, so every closed-market cached snapshot was rejected and forced a redundant
// re-evaluation on every contended request. session_phase is the existing marker that
// distinguishes the two cases.

test("a closed-market snapshot (session_phase: closed) is shareable regardless of its as_of age", () => {
  const now = Date.parse("2026-10-25T21:37:00.000Z");
  const asOf = "2026-10-25T21:15:02.434Z"; // ~22 minutes old -- the live-measured magnitude
  assert.equal(
    isSpxPlaySnapshotShareable({ as_of: asOf, session_phase: "closed" }, now, 20_000),
    true
  );
});

test("a live-market snapshot (session_phase: cash) older than the bound is still rejected -- PR #6719's fix unchanged", () => {
  const now = Date.parse("2026-10-25T21:37:00.000Z");
  const asOf = "2026-10-25T21:15:02.434Z"; // same ~22-minute age as above
  assert.equal(
    isSpxPlaySnapshotShareable({ as_of: asOf, session_phase: "cash" }, now, 20_000),
    false
  );
});

test("a premarket snapshot older than the bound is still rejected (only 'closed' is exempt)", () => {
  const now = 1_000_000;
  const asOf = new Date(now - 30_000).toISOString();
  assert.equal(
    isSpxPlaySnapshotShareable({ as_of: asOf, session_phase: "premarket" }, now, 20_000),
    false
  );
});

test("a fresh live-market snapshot within the bound is shareable, same as the plain freshness check", () => {
  const now = 1_000_000;
  const asOf = new Date(now - 2_000).toISOString();
  assert.equal(
    isSpxPlaySnapshotShareable({ as_of: asOf, session_phase: "cash" }, now, 20_000),
    true
  );
});

test("a null/undefined cached value is rejected (fail closed)", () => {
  assert.equal(isSpxPlaySnapshotShareable(null, 1_000_000, 20_000), false);
  assert.equal(isSpxPlaySnapshotShareable(undefined, 1_000_000, 20_000), false);
});
