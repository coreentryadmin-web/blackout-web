import test from "node:test";
import assert from "node:assert/strict";

import type { GexWalls } from "@/lib/providers/gex-wall-levels";
import { DEFAULT_WALL_MEMBERSHIP, resolveWallMembership } from "./vector-wall-membership";

/** One bucket: strikes listed strongest-first, turned into a descending-pct ladder. */
function bucket(...strikes: number[]): GexWalls {
  return {
    callWalls: strikes.map((strike, i) => ({ strike, pct: 100 - i })),
    putWalls: [],
  };
}

const CFG = { enterRank: 2, holdRank: 4, graceBuckets: 2 };

test("THE DEFECT: a strike near the cut keeps its row instead of blinking out", () => {
  // Rank 3 every other bucket. Under the old per-bucket top-2 slice this row was present, absent,
  // present, absent — the dotted line members reported. holdRank 4 keeps it alive throughout.
  const buckets = [
    bucket(10, 20, 30),
    bucket(10, 30, 20),
    bucket(10, 20, 30),
    bucket(10, 30, 20),
  ];
  const m = resolveWallMembership(buckets, "callWalls", CFG);
  // 30 is rank 3 in bucket 0, so it is not born yet — birth still requires the strong rank.
  assert.equal(m[0]!.has(30), false, "not born until it ranks strongly");
  // It reaches rank 2 in bucket 1 and is born; from then on rank 3 is inside holdRank, so the row
  // is CONTINUOUS instead of alternating present/absent as the old per-bucket slice made it.
  for (let i = 1; i < buckets.length; i++) {
    assert.ok(m[i]!.has(30), `bucket ${i} must keep strike 30`);
    assert.ok(m[i]!.has(20), `bucket ${i} must keep strike 20`);
  }
});

test("birth requires the STRONG rank — ordinary relevance is not enough to start a row", () => {
  // 30 sits at rank 3 forever: inside holdRank, never inside enterRank. It must never be born,
  // otherwise every strike in the recorded ladder eventually owns a row and the rail is a grid.
  const buckets = [bucket(10, 20, 30), bucket(10, 20, 30), bucket(10, 20, 30)];
  const m = resolveWallMembership(buckets, "callWalls", CFG);
  for (const set of m) assert.equal(set.has(30), false, "rank-3-forever must not earn a row");
});

test("death takes sustained decay, not one bad bucket", () => {
  // Born strong, then falls outside holdRank. It must survive `graceBuckets` and die on the next.
  const buckets = [
    bucket(30, 10, 20),      // 30 born at rank 1
    bucket(10, 20, 40, 50, 30), // rank 5 — outside holdRank 4 → miss 1
    bucket(10, 20, 40, 50, 30), // miss 2
    bucket(10, 20, 40, 50, 30), // grace spent → dies
  ];
  const m = resolveWallMembership(buckets, "callWalls", CFG);
  assert.ok(m[0]!.has(30), "born");
  assert.ok(m[1]!.has(30), "survives the first miss");
  assert.ok(m[2]!.has(30), "survives the second miss");
  assert.equal(m[3]!.has(30), false, "dies once grace is spent");
});

test("recovering inside holdRank resets the grace — a wall that comes back does not die", () => {
  const buckets = [
    bucket(30, 10, 20),
    bucket(10, 20, 40, 50, 30), // miss 1
    bucket(10, 30, 20),         // back at rank 2 → reset
    bucket(10, 20, 40, 50, 30), // miss 1 again
    bucket(10, 20, 40, 50, 30), // miss 2
  ];
  const m = resolveWallMembership(buckets, "callWalls", CFG);
  assert.ok(m[4]!.has(30), "grace restarted on recovery, so it is still alive");
});

test("a row that is alive but ABSENT from a bucket emits nothing — no fabricated bead", () => {
  // The strike vanishes from the ladder entirely. It must keep its identity (no re-birth later)
  // without the renderer drawing a bead there — a rail that fills its own holes is worse than one
  // that shows them.
  const buckets = [bucket(30, 10), bucket(10, 20), bucket(30, 10)];
  const m = resolveWallMembership(buckets, "callWalls", CFG);
  assert.ok(m[0]!.has(30));
  assert.equal(m[1]!.has(30), false, "absent from the ladder → no bead");
  assert.ok(m[2]!.has(30), "same row resumes rather than a new one being born");
});

test("reverse hysteresis is clamped — holdRank below enterRank would churn worse than none", () => {
  const buckets = [bucket(10, 20, 30), bucket(10, 20, 30)];
  const bad = resolveWallMembership(buckets, "callWalls", { enterRank: 5, holdRank: 1, graceBuckets: 0 });
  const clamped = resolveWallMembership(buckets, "callWalls", { enterRank: 5, holdRank: 5, graceBuckets: 0 });
  assert.deepEqual([...bad[1]!].sort(), [...clamped[1]!].sort());
});

test("the shipped defaults have real hysteresis and real grace", () => {
  // If these ever collapse to equality the module silently degrades to the per-bucket ranking it
  // replaced, with no test failing anywhere else.
  assert.ok(
    DEFAULT_WALL_MEMBERSHIP.holdRank > DEFAULT_WALL_MEMBERSHIP.enterRank,
    "staying must be easier than being born"
  );
  assert.ok(DEFAULT_WALL_MEMBERSHIP.graceBuckets >= 1, "one bad scan must not kill a wall");
});

test("empty, null and malformed buckets are tolerated and yield no members", () => {
  const m = resolveWallMembership(
    [null, { callWalls: [], putWalls: [] }, { callWalls: [{ strike: NaN, pct: 5 }], putWalls: [] }],
    "callWalls",
    CFG
  );
  assert.equal(m.length, 3);
  for (const set of m) assert.equal(set.size, 0);
});

test("output is index-aligned with the input buckets", () => {
  // The caller pairs these back to history[i]; a length mismatch would silently shift every row in
  // time, which is the kind of bug that looks like a data problem.
  const buckets = [bucket(1), null, bucket(2), bucket(3)];
  assert.equal(resolveWallMembership(buckets, "callWalls", CFG).length, buckets.length);
});
